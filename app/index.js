let winston = require('winston');
let logger = new winston.Logger();
let loggly = require('winston-loggly-bulk');
let Redis = require("ioredis");
let TwitterReceiver = require('./twitter_receiver');
let request = require('request-promise-native');
let yaml = require('js-yaml');
let _ = require('lodash');
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

        logger.add(winston.transports.Loggly, {
            subdomain: process.env.LOGGLY_API_DOMAIN,
            token:process.env.LOGGLY_API_KEY,
            tags:['filingcabinet'],
            level:'error',
            json: true,
            handleExceptions: true,
            humanReadableUnhandledException: true
        });


        logger.info('Filing Cabinet - Twitter Started'); 

        // redis connection
        let redis = new Redis(process.env.REDIS_PORT, process.env.REDIS_HOST);
        
        redis.on('connect', function () {
            logger.info('Redis Connected');        
        });

        redis.on('error', function (error) {
            logger.error(error);        
        });


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
            tmp.on('message',(message) => {
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
                    newmessage.replyto = message.in_reply_to_status_id_str;
                if (message.retweeted_status)
                    newmessage.remessageto = message.retweeted_status.id_str;

                //publish to redis pubsub
                redis.publish('messages', JSON.stringify(newmessage));
            });
            tmp.on('delete',(message)=>{
                logger.info("Delete Tweet",message);
            });
            tmp.on('log',(log)=>{
                logger.info(log);
            });
            tmp.on('error', (err) => {
                logger.error(err);
                process.exit(1);
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