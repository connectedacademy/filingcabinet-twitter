# Filing Cabinet Twitter

[![Docker Pulls](https://img.shields.io/docker/pulls/connectedacademy/filingcabinet-twitter.svg)](https://hub.docker.com/r/connectedacademy/filingcabinet-twitter/)

Application to monitors Twitter and push incoming and batch received messages into beanstalk queue based on search tags from GitHub and credentials from OrientDB.

On Startup it:

- Retrieves a YAML specficiation from the given URL.
- Queries OrientDB for the specified user and their credentials
- Uses these credentials to start a Twitter client
- Queries the previous backlog of messages, then starts a listener on new messages for the hashtag specified in the spec.

> MUST BE THE ONLY INSTANCE RUNNING, AS TWITTER WILL BLOCK MULTIPLE STREAMING CONNECTIONS

## Deployment

`docker-compose up -d`

## Operation

- Main GitHub repo is accessed to get course list
- For each course, the repo is accessed to get search criteria and account info
- For each account, OrientDB is queried to get credentials
- For each account, a Twitter stream and timed backlog search are setup.
- For each message that comes in from Twitter, the format is normalised and published to a beanstalk queue.

Messages are in the following format:
```
message_id
_raw
text
service
createdAt
entities
user_from
replyto
remessageto
lang
```