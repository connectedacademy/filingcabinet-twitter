const Twitter = require('twitter');
const EventEmitter = require('events');

class TwitterReceiver extends EventEmitter
{

    constructor(config)
    {
        super();
        this.config = config;
        this.max_seen_id = 0;
    }

    async start()
    {
        this.client = new Twitter({
            consumer_key: process.env.TWITTER_ACCESS_TOKEN,
            consumer_secret: process.env.TWITTER_ACCESS_SECRET,
            access_token_key: this.config.credentials.token,
            access_token_secret: this.config.credentials.secret
        });


        this.emit('log','Getting Initial Backlog for ' + this.config.hashtags.join(','));
        await this.backlog();

        if (process.env.STREAM == true)
        {
            //streaming feed
            let stream = this.client.stream('statuses/filter', {
                track: this.config.hashtags.join(',')
            });

            stream.on('data', (event)=> {
                // console.log(event && event.text);
                this.emit('message',event);
                //sets the last seen id
                if (event.id > this.max_seen_id)
                    this.max_seen_id = event.id
            });

            stream.on('error',(err)=>{
                // console.log(err);
                this.emit('error',err);
            });

            this.emit('log','Streaming ' + this.config.hashtags.join(','));
        }

        setTimeout(()=>{
            this.backlog()
        },process.env.BACKLOG_TIMEOUT);
    }

    async backlog()
    {
        this.emit('log','Processing backlog');
        try
        {
            //go back in time and get the backlog for this seach term
            var tweets = await this.client.get('search/tweets', {
                q: this.config.hashtags.join(','),
                count: 5,
                max_id: this.max_seen_id
            });

            // console.log(tweets);

            //for each tweet, publish
            for (let tweet of tweets.statuses)
            {
                if (tweet.id > this.max_seen_id)
                    this.max_seen_id = tweet.id
                this.emit('message',tweet);
            }
        }
        catch (e)
        {
            this.emit('error',e);
        }
    }
}

module.exports = TwitterReceiver