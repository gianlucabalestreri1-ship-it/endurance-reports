#!/usr/bin/env node
'use strict';
/*
 * Marca como leídas en Endurance Tool las notificaciones sin leer (feedbacks +
 * carreras), para que el próximo reporte no las repita. Es la ÚNICA escritura
 * del flujo. Correr DESPUÉS de haber generado y entregado el reporte de feedback.
 *
 * Por defecto marca todas las pendientes salvo las de servicios/otros
 * (request_service, adhesiones, soporte). Con ids explícitos marca solo esos.
 *
 * Uso: node mark-read.js            (todas las pendientes de feedback/carreras)
 *      node mark-read.js 123 456    (ids puntuales)
 *      node mark-read.js --dry       (solo muestra el desglose, no marca)
 */
const ET = require('./lib/endurance');

const IGNORE = new Set(['request_service', 'service_request', 'adhesion_request', 'support_response', 'team_assignment']);

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  if (!email || !password) { console.error('Faltan ET_EMAIL / ET_PASSWORD'); process.exit(1); }
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const explicit = argv.filter((x) => /^\d+$/.test(x)).map(Number);

  const { session } = await ET.login(email, password);
  const pending = (await ET.listNotifications(session)).filter((n) => n.status === 'pending');
  const byType = {}; pending.forEach((n) => (byType[n.type] = (byType[n.type] || 0) + 1));
  console.log(`Sin leer: ${pending.length} ·`, JSON.stringify(byType));

  const ids = explicit.length ? explicit : pending.filter((n) => !IGNORE.has(n.type)).map((n) => n.id);
  if (!ids.length) { console.log('Nada para marcar.'); return; }
  if (dry) { console.log(`(--dry) marcaría ${ids.length} notificaciones.`); return; }

  await ET.markNotificationsRead(session, ids);
  const after = (await ET.listNotifications(session)).filter((n) => n.status === 'pending').length;
  console.log(`Marcadas como leídas: ${ids.length}. Sin leer ahora: ${after}.`);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
