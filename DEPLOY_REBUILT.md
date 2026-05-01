# TurfLynk rebuilt drop-in package

This package repairs the broken server/public layout from the WinSCP overwrite issue.

## Fixed

- Restored `server/index.js` in the correct app folder.
- Added missing `server/db.cjs` PostgreSQL helper and schema initializer.
- Added missing `server/routes/aiDetectGrass.cjs` so PM2 no longer crashes on `Cannot find module './routes/aiDetectGrass.cjs'`.
- Added `routes/upload.js` for `/api/upload`.
- Preserved patched auth/admin frontend files.
- Kept current JSON seed data and vision service source.
- Did not include `node_modules`, `.venv`, logs, nested old tar files, or your live `.env`.

## Deploy on server

```bash
cd /var/www
cp -a turflynk-arkansas-quote-ready-fixed-v3 turflynk-before-rebuilt-$(date +%Y%m%d-%H%M%S)
```

Upload this archive to `/var/www`, then:

```bash
cd /var/www
mkdir -p /tmp/turflynk-rebuilt
rm -rf /tmp/turflynk-rebuilt/*
tar -xzf turflynk-rebuilt-clean-dropin.tar.gz -C /tmp/turflynk-rebuilt
rsync -av --exclude='.env' /tmp/turflynk-rebuilt/turflynk-arkansas-quote-ready-fixed-v3/ /var/www/turflynk-arkansas-quote-ready-fixed-v3/
cd /var/www/turflynk-arkansas-quote-ready-fixed-v3
npm install
pm2 restart turflynk --update-env
sleep 2
curl http://127.0.0.1:3000/health
```

If PM2 still errors:

```bash
pm2 logs turflynk --lines 80
```

