#!/bin/bash
echo "$(date '+%F %T') preflight start" >> /var/log/seatbot/login.log
systemctl start seatbot-login.service
echo "$(date '+%F %T') requested seatbot-login" >> /var/log/seatbot/login.log
