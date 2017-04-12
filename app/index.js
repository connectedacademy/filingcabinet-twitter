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

        try
        {
            await db.class.create('credentials', '');   
            logger.info("Created Credentials Class");    
        }
        catch (e)
        {
            //already exists
        }

        try
        {
            Credentials = await db.class.get('credentials');
        }
        catch (e)
        {
            logger.error(e);
        }

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
                logger.verbose('Retrieving ' + w.url + '/config/structure.yml');          
                let temp = await request.get(w.url + '/config/structure.yml');
                let yml = yaml.safeLoad(temp);
                // console.log(yml);
                logger.verbose('Getting Credentials for ' + yml.accounts);          
                let creds = await db.select().from('user')
                .where({
                    account: yml.accounts
                }).all();

                if (creds.length > 0)
                {
                    _.each(creds,(cred)=>{
                        courses.push({
                            user: yml.accounts,
                            hashtags: yml.hashtags,
                            credentials: cred
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

        let test = new TwitterReceiver({
            user: "@tombartindale",
            hashtags: ['#brexit'],
            credentials:{
                key: 'Mw5yOFGqH1hEybhqeXzNCNecO',
                secret: 'cCnvByxi1xQV5USACc1tglpeMgAePkD5yZnC5A0CqEVKLu2TNa',
                token:'17308978-yG8b4jCrWSZwQdZKfW5emKAdg1MiHPZskJUiZuNLq',
                token_secret: '5AWdPXYyTky8kJNLyf3XoeBf8qzbY5o8HoFMdbWJaXVVi'
            }
        });

        test.on('error',(err)=>{
            logger.error(err);
            process.exit(1);
        });
        test.on('log',(log)=>{
            logger.info(log);
        });
        test.on('message',(message)=>{
            logger.verbose('Message received',message.id_str);
            //normalise into message format
            let newmessage = {};

            newmessage.id = message.id_str;
            newmessage._raw = message;

            newmessage.text = message.text;
            newmessage.service = 'twitter';
            newmessage.createdAt = new Date(message.created_at);
            newmessage.entities = message.entities;
            newmessage.user = message.user.id;
            newmessage.lang = message.lang;
            newmessage.replyto = message.in_reply_to_status_id;

            // logger.verbose(JSON.stringify(newmessage));

            //publish to redis pubsub
            redis.publish('messages', JSON.stringify(newmessage));
        });
        test.start();

        logger.info('Created Client List for ' + courses.length + ' clients');             
        // Start a twitter receiver for each of the accounts
        for (let course in courses) {
            let tmp = new TwitterReceiver(course);
            tmp.on('message',(message) => {

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