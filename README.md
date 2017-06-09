# Filing Cabinet Twitter

NodeJS script which monitors Twitter and pushes incoming and batch received messages into beanstalk queue based on search tags from GitHub and credentials from OrientDB.

Designed to be run as a single instance.

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
```