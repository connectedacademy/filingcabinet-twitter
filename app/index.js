let winston = require('winston');
let logger = new winston.Logger();
let fivebeans = require('fivebeans');
let TwitterReceiver = require('./twitter_receiver');
let request = require('request-promise-native');
let yaml = require('js-yaml');
let _ = require('lodash');
let os = require('os');
global.logger = logger;

module.exports = async function()
{
    try
    {
        logger.add(winston.transports.Console, {
            level: 'debug',
            colorize: true,
            handleExceptions: true,
            humanReadableUnhandledException: true
        });

        //REMOTE LOGGING
        if (!process.env.CI && process.env.NODE_ENV=='production')
        {
          let logzioWinstonTransport = require('winston-logzio');
          let loggerOptions = {
              token: process.env.LOGZ_TOKEN,
              host: 'listener.logz.io',
              type: 'filingcabinet-twitter',
              level: 'verbose'
          };
          logger.on('error',(err)=>{
            console.error(err);
          });
          logger.add(logzioWinstonTransport,loggerOptions);
            
          // let winstonAwsCloudWatch = require('winston-cloudwatch');
          // customLogger.add(winstonAwsCloudWatch, {
          //   logGroupName: 'ConnectedAcademyAPI',
          //   logStreamName:'watercooler',
          //   awsRegion: process.env.AWS_DEFAULT_REGION,
          //   jsonMessage: true,
          //   level:'verbose'
          // });
        }



        logger.info('Filing Cabinet - Twitter Started'); 

        let beanstalk = new fivebeans.client(process.env.BEANSTALK_SERVER, 11300);
        beanstalk.on('error', function(err)
        {
            logger.error(err);
        })
        .on('close', function()
        {
            logger.error("Beanstalk Closed");            
        });

        await new Promise((resolve, reject)=>{
            beanstalk.on('connect', function()
            {
                resolve();
            })
            .connect();
        });

        let tubename = await new Promise((resolve, reject)=>{
            beanstalk.use('messages', function(err, tubename) {
                if (err)
                    reject(err);
                else
                    resolve(tubename);
            });
        });

        logger.info('Connected to Beanstalk');

        // DB Access
        let OrientDB = require('orientjs');

        let server = OrientDB({
            host:       process.env.ORIENTDB_HOST,
            port:       process.env.ORIENTDB_PORT,
            username:   process.env.ORIENTDB_USERNAME,
            password:   process.env.ORIENTDB_PASSWORD
        });
        logger.info("Connected to " + process.env.ORIENTDB_HOST);            
        let db = server.use(process.env.ORIENTDB_DB)
        logger.info("Using database " + db.name);

        // Obtain Twitter search terms and accounts
        logger.verbose('Retrieving ' + process.env.MASTER_REPO + 'config/courses.yml');          
        let whitelist_raw = await request.get(process.env.MASTER_REPO + '/config/courses.yml');
        let whitelist = yaml.safeLoad(whitelist_raw);
        logger.info('Retrieved Course List');     
        let courses = [];
        // console.log(whitelist);
        for (let k in whitelist.courses) {
            let w = whitelist.courses[k];
            try
            {
                logger.verbose('Retrieving ' + w.url + '/course/config/spec.yaml');          
                let temp = await request.get(w.url + '/course/config/spec.yaml');
                let yml = yaml.safeLoad(temp);
                // console.log(yml);
                logger.verbose('Getting Credentials for ' + yml.accounts);
                // console.log(yml.accounts);      
                let users = await db.query(
                    'SELECT account_credentials,credentials, account FROM user WHERE service=:service AND account IN :accounts',
                    {
                        params: {
                            service: 'twitter',
                            accounts:yml.accounts
                        }
                    });
                // console.log(users);

                if (users.length > 0)
                {
                    _.each(users,(user)=>{
                        courses.push({
                            user: user.account,
                            hashtags: yml.hashtag,
                            credentials: _.extend(user.account_credentials,user.credentials)
                        });
                    });
                }
                else
                {
                    logger.error("No credentials stored for " + yml.accounts);
                }
            }
            catch (e)
            {
                logger.error(e);
            }
        }

        let clients = [];

        logger.info('Created Client List for ' + courses.length + ' clients');             
        // Start a twitter receiver for each of the accounts
        for (let course of courses) {
            let tmp = new TwitterReceiver(course);
            tmp.on('message',async (message) => {
                logger.verbose('Message received',message.id_str);
                //normalise into message format
                let newmessage = {};

                newmessage.message_id = message.id_str;
                newmessage._raw = message;

                newmessage.text = message.text;
                newmessage.service = 'twitter';
                newmessage.createdAt = new Date(message.created_at);
                newmessage.entities = message.entities;
                newmessage.user_from = message.user;
                newmessage.lang = message.lang;
                if (message.in_reply_to_status_id_str)
                {
                    try
                    {
                        let msg = await tmp.getSingle(message.in_reply_to_status_id_str);
                        let replytomsg = {};
                        replytomsg.message_id = msg.id_str;
                        replytomsg._raw = msg;

                        replytomsg.text = msg.text;
                        replytomsg.service = 'twitter';
                        replytomsg.createdAt = new Date(msg.created_at);
                        replytomsg.entities = msg.entities;
                        replytomsg.user_from = msg.user;
                        replytomsg.lang = msg.lang;

                        newmessage.replyto = replytomsg;
                    }
                    catch(e)
                    {
                        logger.error(e);
                    }
                }
                if (message.retweeted_status)
                    newmessage.remessageto = message.retweeted_status.id_str;
                if (message.quoted_status)
                    newmessage.remessageto = message.quoted_status.id_str;

                //publish to redis pubsub
                // redis.publish('messages', JSON.stringify(newmessage));
                let msg= JSON.stringify({type:'message',payload:newmessage});
                beanstalk.put(10, 0, 50000000, msg, function(err, jobid) {
                        // console.log(jobid);
                    if (err)
                        logger.error(err);
                });
            });
            tmp.on('delete',(message)=>{
                logger.info("Delete Tweet",message);
                let newmessage = {};
                newmessage.message_id = message.id_str;
                let msg= JSON.stringify({type:'delete',payload:newmessage});
                beanstalk.put(10, 0, 50000000, msg, function(err, jobid) {
                        // console.log(jobid);
                    if (err)
                        logger.error(err);
                });
            });
            tmp.on('cleargeo',(message)=>{
                logger.info("Clear Geo on Tweet",message);
                let newmessage = {};
                newmessage.message_id = message.id_str;
                let msg= JSON.stringify({type:'rmgeo',payload:newmessage});
                beanstalk.put(10, 0, 50000000, msg, function(err, jobid) {
                        // console.log(jobid);
                    if (err)
                        logger.error(err);
                });
            });
            tmp.on('log',(log)=>{
                logger.info(log);
            });
            tmp.on('error', (err) => {
                // console.log(tmp.config);
                logger.error(err, tmp.config);
                // process.exit(1);
            });
            clients.push(tmp);
            tmp.start();
        };
        logger.info('Created ' + courses.length + ' Clients');
        logger.info('Listening for Messages');
    }
    catch (e)
    {
        logger.error(e);
        process.exit(1);
    }
}