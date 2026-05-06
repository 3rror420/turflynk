pm2 delete turflynk-vision

cd /var/www/turflynk-arkansas-quote-ready-fixed-v3

pm2 start "python3 -m uvicorn vision_service.app:app --host 127.0.0.1 --port 8017" \
  --name turflynk-vision

pm2 save
pm2 status
curl http://127.0.0.1:8017/health
