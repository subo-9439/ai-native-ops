const express = require('express');
const dgram   = require('dgram');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.WOL_SECRET;

// WoL 매직 패킷 생성 (6바이트 FF × 6 + MAC × 16)
function buildMagicPacket(mac) {
  const macBytes = mac.replace(/[:\-]/g, '').match(/.{2}/g).map(b => parseInt(b, 16));
  const buf = Buffer.alloc(102);
  buf.fill(0xff, 0, 6);
  for (let i = 1; i <= 16; i++) {
    macBytes.forEach((b, j) => { buf[i * 6 + j] = b; });
  }
  return buf;
}

// UDP 매직 패킷 발송
function sendWol(mac, ip, port = 9) {
  return new Promise((resolve, reject) => {
    const packet = buildMagicPacket(mac);
    const sock   = dgram.createSocket('udp4');
    sock.once('error', reject);
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(packet, 0, packet.length, port, ip, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

app.use(express.json());

// 헬스체크
app.get('/', (req, res) => res.json({ status: 'ok', service: 'wol-relay' }));

// WoL 트리거
app.post('/wakeup', async (req, res) => {
  // 시크릿 검증
  const secret = req.headers['x-wol-secret'] || req.body?.secret;
  if (SECRET && secret !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const mac = req.body?.mac || process.env.PC_MAC;
  const ip  = req.body?.ip  || process.env.PC_PUBLIC_IP;

  if (!mac || !ip) {
    return res.status(400).json({ error: 'mac, ip required' });
  }

  try {
    console.log(`[WoL] Sending magic packet → ${mac} @ ${ip}`);
    await sendWol(mac, ip);
    console.log(`[WoL] Sent OK`);
    res.json({ ok: true, mac, ip });
  } catch (err) {
    console.error('[WoL] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`[WoL] Service running on port ${PORT}`));
