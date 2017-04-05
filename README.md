# Filing Cabinet Twitter

NodeJS script which monitors Twitter and pushes incoming and batch received messages into Redis PUBSUB based on search tags from GitHub and credentials from Vault.

Designed to be run as a single instance.

## Deployment

`docker-compose up -d`