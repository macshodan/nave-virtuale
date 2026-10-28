/*!
 * nave.js — NAVE VIRTUALE
 * Simulatore di backend REST per il corso "Progettazione Applicazioni Mobile Client/Server".
 *
 * Come funziona
 * -------------
 * Includendo questo file in una pagina, tutte le chiamate fetch() verso
 *     https://api.nave.example/v1/...
 * vengono intercettate e gestite da un "server" simulato che gira nel browser.
 * Le chiamate verso qualsiasi altro indirizzo passano normalmente in rete.
 *
 * Per gli studenti è un'API vera a tutti gli effetti: metodi HTTP, header,
 * token JWT, status code, errori in formato standard, paginazione, latenza di rete.
 *
 * Le letture dei sensori sono funzioni deterministiche del tempo: tutti i browser
 * della classe vedono la stessa nave con gli stessi valori nello stesso istante.
 * Le modifiche (soglie, allarmi presi in carico) restano invece nel singolo browser.
 *
 * Endpoint e schemi seguono la specifica OpenAPI vista nella Lezione 23-24.
 */
(function (global) {
  'use strict';

  var BASE_URL = 'https://api.nave.example/v1';
  var CHIAVE_STORAGE = 'naveVirtuale:v1';

  // ─── CONFIGURAZIONE (modificabile da console: Nave.config.xxx = ...) ───────
  var config = {
    latenzaMin: 120,            // ms
    latenzaMax: 450,            // ms
    rete: 'normale',            // 'normale' | 'lenta' | 'offline'
    durataToken: 900,           // secondi (15 min: abbastanza corto da vederlo scadere)
    durataRefresh: 30 * 24 * 3600,
    rateLimit: { finestraMs: 10000, max: 40 },
    vulnerabilita: { idor: true }, // per la lezione sulla sicurezza
    logConsole: true
  };

  // Il "segreto" con cui il server firma i token (HS256).
  // Domanda per la classe: se è scritto qui, nel codice del client, è ancora un segreto?
  var SEGRETO_JWT = 'chiave-segreta-del-server-nave';

  // ─── DATI DI BASE (dallo schema ER della Lezione 19-20) ────────────────────
  var TIPI = [
    { id_tipo: 1, nome: 'batteria', unita_misura: 'V', descrizione: 'Tensione delle celle di batteria' },
    { id_tipo: 2, nome: 'carburante', unita_misura: '%', descrizione: 'Livello di riempimento dei serbatoi' },
    { id_tipo: 3, nome: 'temperatura', unita_misura: '°C', descrizione: 'Temperature di motori e locali' },
    { id_tipo: 4, nome: 'pressione', unita_misura: 'bar', descrizione: 'Pressione di circuiti e impianti' }
  ];

  // Codici IMO di fantasia, ma con cifra di controllo valida (somma pesata 7..2, mod 10)
  var NAVI = [
    { id_nave: 'NA00001', nome: 'Nave Azzurra', codice_imo: '9384710', tipo: 'traghetto', anno_costruzione: 2009, porto_registro: 'Livorno' },
    { id_nave: 'NA00002', nome: 'Stella del Tirreno', codice_imo: '9518232', tipo: 'mercantile', anno_costruzione: 2015, porto_registro: 'Genova' }
  ];

  // modello: come varia il valore nel tempo
  //   base + amp*sin(2πt/periodo) + rumore + evento periodico (picco o calo)
  //   oppure "dente di sega" per i serbatoi che si svuotano e vengono riempiti
  var SENSORI = [
    { id_sensore: 1, id_nave: 'NA00001', id_tipo: 1, nome: 'Batteria principale – Cella 1', posizione: 'Sala macchine, quadro sx', soglia_min: 11.5, soglia_max: 14.4, attivo: true, data_installazione: '2021-03-15',
      m: { base: 12.9, amp: 0.25, periodo: 3600, rumore: 0.05, dec: 2 } },
    { id_sensore: 2, id_nave: 'NA00001', id_tipo: 1, nome: 'Batteria principale – Cella 2', posizione: 'Sala macchine, quadro sx', soglia_min: 11.5, soglia_max: 14.4, attivo: true, data_installazione: '2021-03-15',
      m: { base: 12.75, amp: 0.3, periodo: 4200, rumore: 0.05, dec: 2 } },
    { id_sensore: 3, id_nave: 'NA00001', id_tipo: 1, nome: 'Batteria di emergenza', posizione: 'Ponte di comando, locale UPS', soglia_min: 11.5, soglia_max: 14.4, attivo: true, data_installazione: '2022-06-01',
      m: { base: 12.45, amp: 0.12, periodo: 5400, rumore: 0.04, dec: 2, evento: { ciclo: 5400, durata: 420, delta: -1.4 } } },
    { id_sensore: 4, id_nave: 'NA00001', id_tipo: 2, nome: 'Serbatoio A – gasolio', posizione: 'Doppio fondo, prua', soglia_min: 15, soglia_max: null, attivo: true, data_installazione: '2009-05-20',
      m: { sega: { ciclo: 10800, da: 92, a: 11, sfasamento: 0 }, rumore: 0.2, dec: 1 } },
    { id_sensore: 5, id_nave: 'NA00001', id_tipo: 2, nome: 'Serbatoio B – gasolio', posizione: 'Doppio fondo, poppa', soglia_min: 15, soglia_max: null, attivo: true, data_installazione: '2009-05-20',
      m: { sega: { ciclo: 14400, da: 88, a: 31, sfasamento: 5000 }, rumore: 0.2, dec: 1 } },
    { id_sensore: 6, id_nave: 'NA00001', id_tipo: 3, nome: 'Temperatura motore principale', posizione: 'Sala macchine, motore MP1', soglia_min: 60, soglia_max: 95, attivo: true, data_installazione: '2019-11-02',
      m: { base: 84, amp: 3.5, periodo: 2400, rumore: 0.4, dec: 1, evento: { ciclo: 2700, durata: 240, delta: 16 } } },
    { id_sensore: 7, id_nave: 'NA00001', id_tipo: 3, nome: 'Temperatura sala macchine', posizione: 'Sala macchine', soglia_min: 10, soglia_max: 45, attivo: true, data_installazione: '2019-11-02',
      m: { base: 36, amp: 3, periodo: 7200, rumore: 0.3, dec: 1 } },
    { id_sensore: 8, id_nave: 'NA00001', id_tipo: 4, nome: 'Pressione olio motore', posizione: 'Sala macchine, motore MP1', soglia_min: 2.0, soglia_max: 6.0, attivo: true, data_installazione: '2019-11-02',
      m: { base: 4.2, amp: 0.3, periodo: 1800, rumore: 0.08, dec: 2 } },
    { id_sensore: 9, id_nave: 'NA00001', id_tipo: 4, nome: 'Pressione circuito raffreddamento', posizione: 'Sala macchine, scambiatore', soglia_min: 1.0, soglia_max: 2.5, attivo: false, data_installazione: '2019-11-02',
      m: { base: 1.6, amp: 0.1, periodo: 3000, rumore: 0.05, dec: 2 } },
    { id_sensore: 10, id_nave: 'NA00001', id_tipo: 1, nome: 'Batteria servizi di bordo', posizione: 'Ponte 3, locale tecnico', soglia_min: 23.0, soglia_max: 28.8, attivo: true, data_installazione: '2023-02-10',
      m: { base: 25.6, amp: 0.4, periodo: 6600, rumore: 0.06, dec: 2 } },
    { id_sensore: 11, id_nave: 'NA00001', id_tipo: 3, nome: 'Cella frigorifera cambusa', posizione: 'Ponte 1, cambusa', soglia_min: -25, soglia_max: -15, attivo: true, data_installazione: '2020-04-18',
      m: { base: -19.5, amp: 0.8, periodo: 3300, rumore: 0.2, dec: 1, evento: { ciclo: 4000, durata: 300, delta: 5.6 } } },
    { id_sensore: 12, id_nave: 'NA00001', id_tipo: 4, nome: 'Pressione impianto antincendio', posizione: 'Ponte 2, sala pompe', soglia_min: 6.0, soglia_max: 9.0, attivo: true, data_installazione: '2018-09-30',
      m: { base: 7.6, amp: 0.15, periodo: 9000, rumore: 0.05, dec: 2 } },
    // Seconda nave: un operatore della Nave Azzurra NON dovrebbe poterla vedere…
    { id_sensore: 13, id_nave: 'NA00002', id_tipo: 1, nome: 'Batteria principale', posizione: 'Sala macchine', soglia_min: 23.0, soglia_max: 28.8, attivo: true, data_installazione: '2015-07-01',
      m: { base: 26.1, amp: 0.3, periodo: 5000, rumore: 0.05, dec: 2 } },
    { id_sensore: 14, id_nave: 'NA00002', id_tipo: 2, nome: 'Serbatoio principale', posizione: 'Doppio fondo', soglia_min: 15, soglia_max: null, attivo: true, data_installazione: '2015-07-01',
      m: { sega: { ciclo: 20000, da: 95, a: 40, sfasamento: 1200 }, rumore: 0.2, dec: 1 } },
    { id_sensore: 15, id_nave: 'NA00002', id_tipo: 3, nome: 'Temperatura stiva 2', posizione: 'Stiva 2 – carico riservato (codice FLAG-IDOR-7731)', soglia_min: 2, soglia_max: 8, attivo: true, data_installazione: '2015-07-01',
      m: { base: 4.8, amp: 0.6, periodo: 4000, rumore: 0.15, dec: 1 } }
  ];

  var OPERATORI = [
    { id: 7, nome: 'Mario Rossi', email: 'mario.rossi@nave.it', password: 'Timone2026!', ruolo: 'OPERATORE', id_nave: 'NA00001' },
    { id: 3, nome: 'Giulia Bianchi', email: 'giulia.bianchi@nave.it', password: 'Ancora#88', ruolo: 'CAPO_MACCHINA', id_nave: 'NA00001' },
    { id: 12, nome: 'Ispettore Ospite', email: 'ospite@nave.it', password: 'SoloLettura1', ruolo: 'LETTURA', id_nave: 'NA00001' },
    { id: 1, nome: 'Comandante Ferri', email: 'comandante@nave.it', password: 'Bussola!1999', ruolo: 'ADMIN', id_nave: null }
  ];
  var OPERATORE_TURNO_PRECEDENTE = { id: 5, nome: 'Luca Neri (turno precedente)' };

  var PASSO = 10;               // una lettura ogni 10 secondi
  var FINESTRA_ALLARMI = 24 * 3600;
  var AUTOCHIUSURA = 6 * 3600;  // allarmi rientrati da più di 6 ore: chiusi dal turno precedente

  // ─── STATO LOCALE (persistito nel browser) ─────────────────────────────────
  var stato = caricaStato();
  var versioneStato = 0;

  function statoVuoto() { return { sensori: {}, soglie: {}, allarmi: {}, revocati: {} }; }
  function caricaStato() {
    try {
      var s = global.localStorage && global.localStorage.getItem(CHIAVE_STORAGE);
      if (s) { var o = JSON.parse(s); var v = statoVuoto(); for (var k in v) if (o[k]) v[k] = o[k]; return v; }
    } catch (e) { /* storage non disponibile: si lavora in memoria */ }
    return statoVuoto();
  }
  function salvaStato() {
    versioneStato++;
    try { global.localStorage && global.localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(stato)); } catch (e) {}
  }

  // ─── UTILITÀ ───────────────────────────────────────────────────────────────
  function oraSec() { return Date.now() / 1000; }
  function iso(sec) { return new Date(Math.floor(sec) * 1000).toISOString().slice(0, 19) + 'Z'; }
  function arrotonda(v, dec) { var p = Math.pow(10, dec); return Math.round(v * p) / p; }
  function hash32(a, b) {
    var h = 2166136261 ^ a; h = Math.imul(h ^ (b & 0xffff), 16777619); h = Math.imul(h ^ (b >>> 16), 16777619);
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return h >>> 0;
  }
  function rumore(id, k) { return (hash32(id * 7919, k) / 4294967295) * 2 - 1; }
  function idRichiesta() { return 'req_' + Math.random().toString(16).slice(2, 10); }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function tipoDi(s) { for (var i = 0; i < TIPI.length; i++) if (TIPI[i].id_tipo === s.id_tipo) return TIPI[i]; }
  function naveDi(id) { for (var i = 0; i < NAVI.length; i++) if (NAVI[i].id_nave === id) return NAVI[i]; return null; }
  function sensoreDi(id) { for (var i = 0; i < SENSORI.length; i++) if (SENSORI[i].id_sensore === id) return SENSORI[i]; return null; }

  // Campi correnti di un sensore (base + modifiche fatte via PATCH)
  function campiSensore(s) {
    var mod = stato.sensori[s.id_sensore] || {};
    var soglie = sogliaAl(s, Infinity);
    var t = tipoDi(s);
    return {
      id_sensore: s.id_sensore,
      id_nave: s.id_nave,
      nome: mod.nome !== undefined ? mod.nome : s.nome,
      id_tipo: s.id_tipo,
      tipo_nome: t.nome,
      unita_misura: t.unita_misura,
      posizione: mod.posizione !== undefined ? mod.posizione : s.posizione,
      soglia_min: soglie.min,
      soglia_max: soglie.max,
      ritardo_allarme_s: soglie.ritardo,
      isteresi: soglie.isteresi,
      attivo: mod.attivo !== undefined ? mod.attivo : s.attivo,
      data_installazione: s.data_installazione
    };
  }

  // Regole di allarme valide in un certo istante (lo storico serve a non "riscrivere" gli allarmi passati)
  //   min / max  soglie
  //   ritardo    secondi in cui il valore deve restare fuori soglia prima che scatti l'allarme
  //   isteresi   margine di rientro: l'allarme rientra solo quando il valore torna dentro di almeno questa quantità
  function sogliaAl(s, t) {
    var r = { min: s.soglia_min, max: s.soglia_max, ritardo: 0, isteresi: 0 };
    var st = stato.soglie[s.id_sensore] || [];
    for (var i = 0; i < st.length; i++) if (st[i].da <= t) r = { min: st[i].min, max: st[i].max, ritardo: st[i].ritardo || 0, isteresi: st[i].isteresi || 0 };
    return r;
  }

  // ─── SIMULAZIONE DELLE LETTURE ─────────────────────────────────────────────
  function valoreAl(s, tr) {
    var m = s.m, k = Math.floor(tr / PASSO), v;
    if (m.sega) {
      var f = ((tr + m.sega.sfasamento) % m.sega.ciclo) / m.sega.ciclo;
      v = m.sega.da - (m.sega.da - m.sega.a) * f;
    } else {
      v = m.base + m.amp * Math.sin(2 * Math.PI * tr / m.periodo + s.id_sensore);
    }
    v += (m.rumore || 0) * rumore(s.id_sensore, k);
    if (m.evento) {
      var fase = (tr + s.id_sensore * 137) % m.evento.ciclo;
      if (fase < m.evento.durata) v += m.evento.delta * Math.sin(Math.PI * fase / m.evento.durata);
    }
    return arrotonda(v, m.dec);
  }
  function letturaAl(s, tr) {
    var k = Math.floor(tr / PASSO);
    return {
      id_lettura: k * 100 + s.id_sensore,
      id_sensore: s.id_sensore,
      timestamp: iso(k * PASSO),
      valore: valoreAl(s, k * PASSO),
      qualita: 90 + (hash32(s.id_sensore, k) % 11)
    };
  }
  function ultimoIstante() { return Math.floor(oraSec() / PASSO) * PASSO; }

  function statoValore(v, sog, range) {
    var ecc = 0, lato = null;
    if (sog.min !== null && sog.min !== undefined && v < sog.min) { ecc = sog.min - v; lato = 'MIN'; }
    if (sog.max !== null && sog.max !== undefined && v > sog.max) { ecc = v - sog.max; lato = 'MAX'; }
    if (!lato) return { livello: 'OK', lato: null };
    return { livello: ecc > 0.1 * range ? 'CRITICO' : 'AVVISO', lato: lato };
  }
  function ampiezzaRange(sog, s) {
    if (sog.min !== null && sog.max !== null) return Math.max(sog.max - sog.min, 0.001);
    return Math.max(Math.abs(sog.min !== null ? sog.min : sog.max) , 1) * 0.5;
  }

  // Episodi in cui un sensore è fuori soglia tra "inizio" e "fine".
  // regoleAl(t) restituisce le regole valide all'istante t (soglie, ritardo, isteresi).
  function episodi(s, inizio, fine, regoleAl) {
    var out = [], ep = null;
    for (var t = inizio; t <= fine; t += PASSO) {
      var r = regoleAl(t), v = valoreAl(s, t);
      var sv = statoValore(v, r, ampiezzaRange(r, s));
      var fuori = !!sv.lato;
      if (ep && !fuori && r.isteresi) {
        var rientro = { min: r.min !== null ? r.min + r.isteresi : null, max: r.max !== null ? r.max - r.isteresi : null };
        if (statoValore(v, rientro, 1).lato) fuori = true;
      }
      if (fuori) {
        if (!ep) ep = { s: s, inizio: t, lato: sv.lato, peggiore: 'AVVISO', estremo: v, fine: null, regole: r };
        if (sv.livello === 'CRITICO') ep.peggiore = 'CRITICO';
        if ((ep.lato === 'MIN' && v < ep.estremo) || (ep.lato === 'MAX' && v > ep.estremo)) ep.estremo = v;
      } else if (ep) { ep.fine = t; out.push(ep); ep = null; }
    }
    if (ep) out.push(ep);
    // Ritardo: l'allarme scatta solo se la condizione dura più di "ritardo" secondi
    return out.filter(function (e) {
      var durata = (e.fine !== null ? e.fine : fine + PASSO) - e.inizio;
      return durata > (e.regole.ritardo || 0);
    }).map(function (e) {
      e.scatto = e.inizio + Math.ceil((e.regole.ritardo || 0) / PASSO) * PASSO;
      e.valore_trigger = valoreAl(s, e.scatto);
      e.id_lettura = Math.floor(e.scatto / PASSO) * 100 + s.id_sensore;
      return e;
    });
  }

  // ─── ALLARMI: derivati dalle letture e dalle soglie, poi "corretti" dalle azioni degli operatori
  var cacheAllarmi = { chiave: null, lista: [] };
  function calcolaAllarmi() {
    var fine = ultimoIstante();
    var chiave = fine + ':' + versioneStato;
    if (cacheAllarmi.chiave === chiave) return cacheAllarmi.lista;
    var inizio = fine - FINESTRA_ALLARMI;
    var lista = [];
    SENSORI.forEach(function (s) {
      var campi = campiSensore(s);
      if (!campi.attivo) return;
      lista = lista.concat(episodi(s, inizio, fine, function (t) { return sogliaAl(s, t); }));
    });
    var adesso = oraSec();
    lista = lista.map(function (ep) {
      var id = (Math.floor(ep.inizio / PASSO) * 7 + ep.s.id_sensore) % 900000 + 100000;
      var attiva = ep.fine === null;
      var a = {
        id_allarme: id,
        id_nave: ep.s.id_nave,
        id_sensore: ep.s.id_sensore,
        sensore_nome: campiSensore(ep.s).nome,
        id_lettura_trigger: ep.id_lettura,
        tipo: ep.peggiore,
        valore_trigger: ep.valore_trigger,
        soglia_violata: ep.lato,
        timestamp_apertura: iso(ep.scatto),
        timestamp_chiusura: null,
        stato: 'APERTO',
        condizione_attiva: attiva,
        note_risoluzione: null,
        id_operatore_chiusura: null,
        storico_stati: [{ stato: 'APERTO', timestamp: iso(ep.scatto), operatore: 'sistema' }]
      };
      var az = stato.allarmi[id];
      if (az) {
        if (az.stato === 'RISOLTO') {
          a.stato = 'RISOLTO'; a.note_risoluzione = az.note || null;
          a.storico_stati.push({ stato: 'RISOLTO', timestamp: iso(az.ts), operatore: az.operatore });
          if (!attiva) {
            var tc = Math.max(ep.fine, az.ts);
            a.stato = 'CHIUSO'; a.timestamp_chiusura = iso(tc); a.id_operatore_chiusura = az.id_operatore;
            a.storico_stati.push({ stato: 'CHIUSO', timestamp: iso(tc), operatore: 'sistema (condizione rientrata)' });
          }
        } else if (az.stato === 'CHIUSO') {
          a.stato = 'CHIUSO'; a.note_risoluzione = az.note || null; a.timestamp_chiusura = iso(az.ts); a.id_operatore_chiusura = az.id_operatore;
          a.storico_stati.push({ stato: 'CHIUSO', timestamp: iso(az.ts), operatore: az.operatore });
        }
      } else if (!attiva && adesso - ep.fine > AUTOCHIUSURA) {
        var tchiusura = ep.fine + 1800;
        a.stato = 'CHIUSO'; a.timestamp_chiusura = iso(tchiusura); a.id_operatore_chiusura = OPERATORE_TURNO_PRECEDENTE.id;
        a.note_risoluzione = 'Verificato e chiuso a fine turno';
        a.storico_stati.push({ stato: 'CHIUSO', timestamp: iso(tchiusura), operatore: OPERATORE_TURNO_PRECEDENTE.nome });
      }
      return a;
    });
    lista.sort(function (x, y) { return x.timestamp_apertura < y.timestamp_apertura ? 1 : -1; });
    cacheAllarmi = { chiave: chiave, lista: lista };
    return lista;
  }
  function vistaAllarme(a, completo) {
    var o = copia(a);
    delete o.id_nave;
    if (!completo) { delete o.storico_stati; delete o.id_lettura_trigger; }
    return o;
  }

  // ─── SHA-256 / HMAC / JWT (implementazione didattica, senza librerie) ──────
  var K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(msg) {
    var l = msg.length, tot = Math.ceil((l + 9) / 64) * 64;
    var buf = new Uint8Array(tot); buf.set(msg); buf[l] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(tot - 8, Math.floor(l / 0x20000000)); dv.setUint32(tot - 4, (l * 8) >>> 0);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var i = 0; i < tot; i += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }
  function unisci(a, b) { var r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
  function hmacSha256(chiave, msg) {
    if (chiave.length > 64) chiave = sha256(chiave);
    var k = new Uint8Array(64); k.set(chiave);
    var ip = new Uint8Array(64), op = new Uint8Array(64);
    for (var i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    return sha256(unisci(op, sha256(unisci(ip, msg))));
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function b64url(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function daB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(out);
  }
  function firmaJwt(payload) {
    var testa = b64url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    var corpo = b64url(utf8(JSON.stringify(payload)));
    var firma = b64url(hmacSha256(utf8(SEGRETO_JWT), utf8(testa + '.' + corpo)));
    return testa + '.' + corpo + '.' + firma;
  }
  function decodificaJwt(token) {
    var p = String(token).split('.');
    if (p.length !== 3) return null;
    try { return { header: JSON.parse(daB64url(p[0])), payload: JSON.parse(daB64url(p[1])), firma: p[2] }; }
    catch (e) { return null; }
  }
  function verificaJwt(token) {
    var p = String(token).split('.');
    var dec = decodificaJwt(token);
    if (!dec) return { errore: 'TOKEN_MALFORMED' };
    var attesa = b64url(hmacSha256(utf8(SEGRETO_JWT), utf8(p[0] + '.' + p[1])));
    if (attesa !== p[2] || dec.header.alg !== 'HS256') return { errore: 'TOKEN_INVALID_SIGNATURE' };
    return { payload: dec.payload };
  }
  function creaToken(op, tipo) {
    var adesso = Math.floor(oraSec());
    var durata = tipo === 'refresh' ? config.durataRefresh : config.durataToken;
    return firmaJwt({
      sub: op.id, nome: op.nome, ruolo: op.ruolo, nave: op.id_nave, tipo: tipo,
      iat: adesso, exp: adesso + durata, jti: Math.random().toString(36).slice(2, 12)
    });
  }

  // ─── RISPOSTE E ERRORI ─────────────────────────────────────────────────────
  var TESTI_STATO = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error' };
  function risposta(status, corpo, headerExtra) { return { status: status, corpo: corpo, header: headerExtra || {} }; }
  function errore(status, codice, messaggio, dettagli, headerExtra) {
    var e = { code: codice, message: messaggio };
    if (dettagli) e.details = dettagli;
    e.timestamp = iso(oraSec());
    return risposta(status, { error: e }, headerExtra);
  }

  // ─── AUTENTICAZIONE / AUTORIZZAZIONE ───────────────────────────────────────
  function autentica(req) {
    var h = req.headers['authorization'];
    if (!h) return { r: errore(401, 'TOKEN_MISSING', 'Questa risorsa richiede l\'header Authorization: Bearer <token>. Fai prima il login con POST /auth/login.') };
    var m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (!m) return { r: errore(401, 'TOKEN_MALFORMED', 'Formato dell\'header non valido. Atteso: Authorization: Bearer <token>') };
    var v = verificaJwt(m[1].trim());
    if (v.errore === 'TOKEN_MALFORMED') return { r: errore(401, 'TOKEN_MALFORMED', 'Il token non è un JWT valido (servono tre parti separate da punti).') };
    if (v.errore) return { r: errore(401, 'TOKEN_INVALID_SIGNATURE', 'La firma del token non è valida: il token è stato modificato o non è stato emesso da questo server.') };
    var p = v.payload;
    if (p.tipo !== 'access') return { r: errore(401, 'TOKEN_WRONG_TYPE', 'Questo è un refresh token: usalo solo con POST /auth/refresh.') };
    if (p.exp < oraSec()) return { r: errore(401, 'TOKEN_EXPIRED', 'Il token di autenticazione è scaduto. Rinnovalo con POST /auth/refresh o rifai il login.') };
    if (stato.revocati[p.jti]) return { r: errore(401, 'TOKEN_REVOKED', 'Questo token è stato revocato con il logout.') };
    var op = null; OPERATORI.forEach(function (o) { if (o.id === p.sub) op = o; });
    if (!op) return { r: errore(401, 'TOKEN_INVALID', 'Operatore non riconosciuto.') };
    return { op: op, payload: p };
  }
  function puoVedereNave(op, idNave) { return op.ruolo === 'ADMIN' || op.id_nave === idNave; }
  function vistaOperatore(op) { return { id: op.id, nome: op.nome, email: op.email, ruolo: op.ruolo, id_nave: op.id_nave }; }

  // Controllo nave per le rotte /ships/{shipId}/...
  // ATTENZIONE: per la lezione sulla sicurezza, le rotte dei sensori "dimenticano"
  // di verificare che la nave sia quella dell'operatore (vulnerabilità IDOR).
  function controllaNave(ctx, idNave, saltaControlloPermessi) {
    var nave = naveDi(idNave);
    if (!nave) return errore(404, 'SHIP_NOT_FOUND', 'La nave ' + idNave + ' non esiste.');
    if (!saltaControlloPermessi && !puoVedereNave(ctx.op, idNave)) return errore(403, 'SHIP_FORBIDDEN', 'Non hai i permessi per accedere alla nave ' + idNave + '.');
    return null;
  }
  function sensoreDellaNave(idNave, idS) {
    var n = Number(idS);
    if (!/^\d+$/.test(String(idS))) return { r: errore(400, 'INVALID_PARAMETER', 'sensorId deve essere un numero intero.', [{ field: 'sensorId', issue: 'atteso intero, ricevuto "' + idS + '"' }]) };
    var s = sensoreDi(n);
    if (!s || s.id_nave !== idNave) return { r: errore(404, 'SENSOR_NOT_FOUND', 'Il sensore con ID ' + idS + ' non esiste sulla nave ' + idNave + '.') };
    return { s: s };
  }

  // ─── VALIDAZIONE QUERY ─────────────────────────────────────────────────────
  function paramInt(q, nome, def, min, max) {
    if (q[nome] === undefined) return { v: def };
    if (!/^\d+$/.test(q[nome])) return { r: errore(400, 'INVALID_PARAMETER', 'Il parametro "' + nome + '" deve essere un numero intero.', [{ field: nome, issue: 'valore ricevuto: "' + q[nome] + '"' }]) };
    var v = Number(q[nome]);
    if (v < min || v > max) return { r: errore(400, 'INVALID_PARAMETER', 'Il parametro "' + nome + '" deve essere compreso tra ' + min + ' e ' + max + '.', [{ field: nome, issue: 'valore ricevuto: ' + v }]) };
    return { v: v };
  }
  function paramData(q, nome, def) {
    if (q[nome] === undefined) return { v: def };
    var t = Date.parse(q[nome]);
    if (isNaN(t)) return { r: errore(400, 'INVALID_PARAMETER', 'Il parametro "' + nome + '" deve essere una data ISO 8601, es. 2026-10-26T08:00:00Z.', [{ field: nome, issue: 'valore ricevuto: "' + q[nome] + '"' }]) };
    return { v: t / 1000 };
  }
  function paramNum(q, nome, def, ammettiNull) {
    if (q[nome] === undefined || q[nome] === '') return { v: def };
    if (ammettiNull && /^(null|none)$/i.test(q[nome])) return { v: null };
    var v = Number(q[nome].replace(',', '.'));
    if (isNaN(v)) return { r: errore(400, 'INVALID_PARAMETER', 'Il parametro "' + nome + '" deve essere un numero' + (ammettiNull ? ' (oppure null per nessuna soglia)' : '') + '.', [{ field: nome, issue: 'valore ricevuto: "' + q[nome] + '"' }]) };
    return { v: v };
  }
  function paramEnum(q, nome, valori) {
    if (q[nome] === undefined) return { v: undefined };
    if (valori.indexOf(q[nome]) < 0) return { r: errore(400, 'INVALID_PARAMETER', 'Valore non valido per "' + nome + '". Valori ammessi: ' + valori.join(', ') + '.', [{ field: nome, issue: 'valore ricevuto: "' + q[nome] + '"' }]) };
    return { v: q[nome] };
  }
  function paginazione(lista, page, limit) {
    var tot = lista.length, pagine = Math.max(1, Math.ceil(tot / limit));
    return {
      data: lista.slice((page - 1) * limit, page * limit),
      pagination: { page: page, limit: limit, total_items: tot, total_pages: pagine, has_next: page < pagine, has_prev: page > 1 }
    };
  }

  // ─── HANDLER DELLE ROTTE ───────────────────────────────────────────────────
  function letturaCorrente(s) {
    var l = letturaAl(s, ultimoIstante());
    l.unita_misura = tipoDi(s).unita_misura;
    return l;
  }
  function statoSensore(s) {
    var c = campiSensore(s);
    if (!c.attivo) return 'DISATTIVO';
    var sog = sogliaAl(s, Infinity);
    return statoValore(valoreAl(s, ultimoIstante()), sog, ampiezzaRange(sog, s)).livello;
  }

  var rotte = [
    { m: 'POST', p: '/auth/login', pubblica: true, h: function (ctx) {
      var b = ctx.body;
      if (!b || typeof b !== 'object') return errore(400, 'BODY_REQUIRED', 'Serve un body JSON con i campi "email" e "password".');
      var mancanti = ['email', 'password'].filter(function (k) { return typeof b[k] !== 'string' || !b[k]; });
      if (mancanti.length) return errore(422, 'VALIDATION_ERROR', 'Campi obbligatori mancanti o non validi.', mancanti.map(function (k) { return { field: k, issue: 'obbligatorio (stringa non vuota)' }; }));
      var op = null; OPERATORI.forEach(function (o) { if (o.email.toLowerCase() === b.email.trim().toLowerCase() && o.password === b.password) op = o; });
      if (!op) return errore(401, 'INVALID_CREDENTIALS', 'Email o password non corretti.');
      return risposta(200, { access_token: creaToken(op, 'access'), refresh_token: creaToken(op, 'refresh'), token_type: 'Bearer', expires_in: config.durataToken, operator: vistaOperatore(op) });
    } },
    { m: 'POST', p: '/auth/refresh', pubblica: true, h: function (ctx) {
      var b = ctx.body;
      if (!b || typeof b.refresh_token !== 'string') return errore(422, 'VALIDATION_ERROR', 'Serve il campo "refresh_token".', [{ field: 'refresh_token', issue: 'obbligatorio' }]);
      var v = verificaJwt(b.refresh_token);
      if (v.errore || v.payload.tipo !== 'refresh') return errore(401, 'INVALID_REFRESH_TOKEN', 'Refresh token non valido.');
      if (v.payload.exp < oraSec() || stato.revocati[v.payload.jti]) return errore(401, 'INVALID_REFRESH_TOKEN', 'Refresh token scaduto o revocato: rifai il login.');
      var op = null; OPERATORI.forEach(function (o) { if (o.id === v.payload.sub) op = o; });
      return risposta(200, { access_token: creaToken(op, 'access'), token_type: 'Bearer', expires_in: config.durataToken });
    } },
    { m: 'POST', p: '/auth/logout', h: function (ctx) {
      stato.revocati[ctx.payload.jti] = true; salvaStato();
      return risposta(204, null);
    } },
    { m: 'GET', p: '/auth/me', h: function (ctx) { return risposta(200, vistaOperatore(ctx.op)); } },

    { m: 'GET', p: '/ships', h: function (ctx) {
      var navi = NAVI.filter(function (n) { return puoVedereNave(ctx.op, n.id_nave); }).map(function (n) {
        var aperti = calcolaAllarmi().filter(function (a) { return a.id_nave === n.id_nave && a.stato === 'APERTO'; });
        var o = copia(n);
        o.stato_generale = aperti.some(function (a) { return a.tipo === 'CRITICO'; }) ? 'CRITICO' : aperti.length ? 'AVVISO' : 'OK';
        return o;
      });
      return risposta(200, { data: navi, total: navi.length });
    } },
    { m: 'GET', p: '/ships/{shipId}', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId); if (e) return e;
      var o = copia(naveDi(ctx.params.shipId));
      o.sensori = SENSORI.filter(function (s) { return s.id_nave === o.id_nave; }).map(function (s) {
        var c = campiSensore(s); return { id_sensore: c.id_sensore, nome: c.nome, tipo_nome: c.tipo_nome, stato: statoSensore(s) };
      });
      return risposta(200, o);
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId, config.vulnerabilita.idor); if (e) return e;
      var q = ctx.query;
      var a = paramEnum(q, 'active', ['true', 'false']); if (a.r) return a.r;
      var t = paramEnum(q, 'type', TIPI.map(function (x) { return x.nome; })); if (t.r) return t.r;
      var lista = SENSORI.filter(function (s) { return s.id_nave === ctx.params.shipId; }).map(campiSensore).filter(function (c) {
        if (a.v !== undefined && String(c.attivo) !== a.v) return false;
        if (t.v !== undefined && c.tipo_nome !== t.v) return false;
        return true;
      }).map(function (c) { delete c.id_nave; delete c.data_installazione; return c; });
      return risposta(200, { data: lista, total: lista.length });
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors/{sensorId}', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId, config.vulnerabilita.idor); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      var c = campiSensore(r.s); delete c.id_nave;
      var l = letturaCorrente(r.s);
      c.stato = statoSensore(r.s);
      c.ultima_lettura = { valore: l.valore, timestamp: l.timestamp, qualita: l.qualita };
      return risposta(200, c);
    } },
    { m: 'PATCH', p: '/ships/{shipId}/sensors/{sensorId}', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      if (['CAPO_MACCHINA', 'ADMIN'].indexOf(ctx.op.ruolo) < 0) return errore(403, 'FORBIDDEN', 'Il ruolo ' + ctx.op.ruolo + ' non può modificare i sensori. Serve CAPO_MACCHINA o ADMIN.');
      var b = ctx.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return errore(400, 'BODY_REQUIRED', 'Serve un body JSON con i campi da modificare.');
      var ammessi = { nome: 'string', posizione: 'string', soglia_min: 'number', soglia_max: 'number', ritardo_allarme_s: 'number', isteresi: 'number', attivo: 'boolean' };
      var dettagli = [];
      Object.keys(b).forEach(function (k) {
        if (!ammessi[k]) dettagli.push({ field: k, issue: 'campo non modificabile. Campi ammessi: ' + Object.keys(ammessi).join(', ') });
        else if (b[k] === null && (k === 'soglia_min' || k === 'soglia_max' || k === 'posizione')) { /* null ammesso */ }
        else if (typeof b[k] !== ammessi[k]) dettagli.push({ field: k, issue: 'atteso ' + ammessi[k] + ', ricevuto ' + (b[k] === null ? 'null' : typeof b[k]) });
        else if (k === 'nome' && (!b[k].trim() || b[k].length > 100)) dettagli.push({ field: k, issue: 'deve avere tra 1 e 100 caratteri' });
        else if (k === 'ritardo_allarme_s' && (b[k] < 0 || b[k] > 1800 || Math.round(b[k]) !== b[k])) dettagli.push({ field: k, issue: 'secondi interi tra 0 e 1800' });
        else if (k === 'isteresi' && b[k] < 0) dettagli.push({ field: k, issue: 'non può essere negativa' });
      });
      if (!Object.keys(b).length) return errore(400, 'BODY_EMPTY', 'Il body è vuoto: indica almeno un campo da modificare.');
      if (dettagli.length) return errore(422, 'VALIDATION_ERROR', 'Alcuni campi non sono validi.', dettagli);
      var att = sogliaAl(r.s, Infinity);
      var nmin = b.soglia_min !== undefined ? b.soglia_min : att.min;
      var nmax = b.soglia_max !== undefined ? b.soglia_max : att.max;
      if (nmin !== null && nmax !== null && nmin >= nmax) return errore(422, 'THRESHOLD_ORDER', 'soglia_min (' + nmin + ') deve essere minore di soglia_max (' + nmax + ').', [{ field: 'soglia_min', issue: 'deve essere < soglia_max' }]);
      var nrit = b.ritardo_allarme_s !== undefined ? b.ritardo_allarme_s : att.ritardo;
      var nist = b.isteresi !== undefined ? b.isteresi : att.isteresi;
      if (nist && nmin !== null && nmax !== null && nist >= (nmax - nmin) / 2) return errore(422, 'HYSTERESIS_TOO_LARGE', 'L\'isteresi (' + nist + ') deve essere minore di metà dell\'intervallo tra le soglie (' + arrotonda((nmax - nmin) / 2, 3) + ').', [{ field: 'isteresi', issue: 'troppo grande' }]);
      if (b.soglia_min !== undefined || b.soglia_max !== undefined || b.ritardo_allarme_s !== undefined || b.isteresi !== undefined) {
        (stato.soglie[r.s.id_sensore] = stato.soglie[r.s.id_sensore] || []).push({ da: oraSec(), min: nmin, max: nmax, ritardo: nrit, isteresi: nist, operatore: ctx.op.nome });
      }
      var mod = stato.sensori[r.s.id_sensore] = stato.sensori[r.s.id_sensore] || {};
      ['nome', 'posizione', 'attivo'].forEach(function (k) { if (b[k] !== undefined) mod[k] = b[k]; });
      salvaStato();
      var c = campiSensore(r.s); delete c.id_nave;
      return risposta(200, c);
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors/{sensorId}/readings/latest', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId, config.vulnerabilita.idor); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      return risposta(200, letturaCorrente(r.s));
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors/{sensorId}/readings', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId, config.vulnerabilita.idor); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      var fine = ultimoIstante();
      var until = paramData(ctx.query, 'until', fine); if (until.r) return until.r;
      var since = paramData(ctx.query, 'since', fine - 3600); if (since.r) return since.r;
      var page = paramInt(ctx.query, 'page', 1, 1, 100000); if (page.r) return page.r;
      var limit = paramInt(ctx.query, 'limit', 20, 1, 100); if (limit.r) return limit.r;
      var u = Math.min(until.v, fine), sv = Math.max(since.v, fine - 7 * 86400);
      if (sv > u) return errore(400, 'INVALID_RANGE', '"since" deve essere precedente a "until".');
      // Ordine: dalla più recente alla più vecchia
      var tPrimo = Math.floor(u / PASSO) * PASSO, tUltimo = Math.ceil(sv / PASSO) * PASSO;
      var totale = Math.max(0, Math.floor((tPrimo - tUltimo) / PASSO) + 1);
      var pagine = Math.max(1, Math.ceil(totale / limit.v));
      var dati = [];
      for (var i = (page.v - 1) * limit.v; i < Math.min(page.v * limit.v, totale); i++) dati.push(letturaAl(r.s, tPrimo - i * PASSO));
      return risposta(200, { data: dati, pagination: { page: page.v, limit: limit.v, total_items: totale, total_pages: pagine, has_next: page.v < pagine, has_prev: page.v > 1 } });
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors/{sensorId}/readings/aggregate', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId, config.vulnerabilita.idor); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      var INT = { '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };
      var iv = paramEnum(ctx.query, 'interval', Object.keys(INT)); if (iv.r) return iv.r;
      var interval = iv.v || '1h', dur = INT[interval];
      var fine = ultimoIstante();
      var until = paramData(ctx.query, 'until', fine); if (until.r) return until.r;
      var since = paramData(ctx.query, 'since', fine - 86400); if (since.r) return since.r;
      var u = Math.min(until.v, fine), sv = Math.max(since.v, fine - 7 * 86400);
      if (sv > u) return errore(400, 'INVALID_RANGE', '"since" deve essere precedente a "until".');
      var primo = Math.floor(sv / dur) * dur;
      if ((u - primo) / dur > 500) return errore(400, 'RANGE_TOO_LARGE', 'Troppi intervalli richiesti (massimo 500). Usa un "interval" più grande o un periodo più breve.');
      var passoCampione = Math.max(PASSO, dur / 360);
      var dati = [];
      for (var b0 = primo; b0 <= u; b0 += dur) {
        var somma = 0, n = 0, mn = Infinity, mx = -Infinity;
        for (var t = Math.max(b0, Math.ceil(sv / PASSO) * PASSO); t < Math.min(b0 + dur, u + 1); t += passoCampione) {
          var v = valoreAl(r.s, Math.floor(t / PASSO) * PASSO); somma += v; n++; if (v < mn) mn = v; if (v > mx) mx = v;
        }
        if (n) dati.push({ ora: iso(b0), media: arrotonda(somma / n, r.s.m.dec), minimo: mn, massimo: mx, campioni: n });
      }
      return risposta(200, { sensor_id: r.s.id_sensore, unita_misura: tipoDi(r.s).unita_misura, interval: interval, data: dati });
    } },
    { m: 'GET', p: '/ships/{shipId}/sensors/{sensorId}/alarm-preview', h: function (ctx) {
      // "E se…?": quanti allarmi avrebbe generato questo sensore nelle ultime 24 ore con regole diverse
      var e = controllaNave(ctx, ctx.params.shipId); if (e) return e;
      var r = sensoreDellaNave(ctx.params.shipId, ctx.params.sensorId); if (r.r) return r.r;
      var att = sogliaAl(r.s, Infinity), q = ctx.query;
      var pmin = paramNum(q, 'soglia_min', att.min, true); if (pmin.r) return pmin.r;
      var pmax = paramNum(q, 'soglia_max', att.max, true); if (pmax.r) return pmax.r;
      var prit = paramNum(q, 'ritardo_allarme_s', att.ritardo); if (prit.r) return prit.r;
      var pist = paramNum(q, 'isteresi', att.isteresi); if (pist.r) return pist.r;
      if (pmin.v === null && pmax.v === null) return errore(400, 'INVALID_PARAMETER', 'Serve almeno una soglia (soglia_min o soglia_max).');
      if (pmin.v !== null && pmax.v !== null && pmin.v >= pmax.v) return errore(422, 'THRESHOLD_ORDER', 'soglia_min deve essere minore di soglia_max.');
      if (prit.v < 0 || prit.v > 1800) return errore(400, 'INVALID_PARAMETER', 'ritardo_allarme_s deve essere tra 0 e 1800.');
      if (pist.v < 0) return errore(400, 'INVALID_PARAMETER', 'isteresi non può essere negativa.');
      var fine = ultimoIstante(), inizio = fine - 86400;
      function riassunto(reg, conEpisodi) {
        var eps = episodi(r.s, inizio, fine, function () { return reg; });
        var fuori = 0; eps.forEach(function (x) { fuori += ((x.fine !== null ? x.fine : fine + PASSO) - x.inizio); });
        var o = { soglia_min: reg.min, soglia_max: reg.max, ritardo_allarme_s: reg.ritardo, isteresi: reg.isteresi,
          allarmi: eps.length,
          critici: eps.filter(function (x) { return x.peggiore === 'CRITICO'; }).length,
          avvisi: eps.filter(function (x) { return x.peggiore === 'AVVISO'; }).length,
          minuti_in_allarme: Math.round(fuori / 60) };
        if (conEpisodi) o.episodi = eps.map(function (x) {
          return { scatto: iso(x.scatto), durata_s: (x.fine !== null ? x.fine : fine + PASSO) - x.inizio, valore_estremo: x.estremo, tipo: x.peggiore };
        }).reverse();
        return o;
      }
      return risposta(200, {
        sensor_id: r.s.id_sensore, nome: campiSensore(r.s).nome, unita_misura: tipoDi(r.s).unita_misura,
        periodo: { since: iso(inizio), until: iso(fine) },
        impostazioni_attuali: riassunto(att, false),
        simulazione: riassunto({ min: pmin.v, max: pmax.v, ritardo: prit.v, isteresi: pist.v }, true)
      });
    } },
    { m: 'GET', p: '/ships/{shipId}/dashboard', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId); if (e) return e;
      var dati = SENSORI.filter(function (s) { return s.id_nave === ctx.params.shipId; }).map(function (s) {
        var c = campiSensore(s), l = letturaCorrente(s);
        return { id_sensore: c.id_sensore, nome: c.nome, tipo: c.tipo_nome, valore: c.attivo ? l.valore : null, unita: c.unita_misura, stato: statoSensore(s), timestamp: l.timestamp };
      });
      return risposta(200, { id_nave: ctx.params.shipId, aggiornato_il: iso(ultimoIstante()), data: dati });
    } },
    { m: 'GET', p: '/ships/{shipId}/alarms', h: function (ctx) {
      var e = controllaNave(ctx, ctx.params.shipId); if (e) return e;
      var st = paramEnum(ctx.query, 'status', ['APERTO', 'RISOLTO', 'CHIUSO']); if (st.r) return st.r;
      var ti = paramEnum(ctx.query, 'type', ['CRITICO', 'AVVISO', 'INFO']); if (ti.r) return ti.r;
      var since = paramData(ctx.query, 'since', 0); if (since.r) return since.r;
      var page = paramInt(ctx.query, 'page', 1, 1, 100000); if (page.r) return page.r;
      var limit = paramInt(ctx.query, 'limit', 50, 1, 100); if (limit.r) return limit.r;
      var sid = ctx.query.sensor_id;
      var lista = calcolaAllarmi().filter(function (a) {
        if (a.id_nave !== ctx.params.shipId) return false;
        if (st.v && a.stato !== st.v) return false;
        if (ti.v && a.tipo !== ti.v) return false;
        if (sid !== undefined && String(a.id_sensore) !== sid) return false;
        return Date.parse(a.timestamp_apertura) / 1000 >= since.v;
      }).map(function (a) { return vistaAllarme(a, false); });
      return risposta(200, paginazione(lista, page.v, limit.v));
    } },
    { m: 'GET', p: '/alarms/{alarmId}', h: function (ctx) {
      var r = trovaAllarme(ctx); if (r.r) return r.r;
      return risposta(200, vistaAllarme(r.a, true));
    } },
    { m: 'PATCH', p: '/alarms/{alarmId}', h: function (ctx) {
      var r = trovaAllarme(ctx); if (r.r) return r.r;
      if (ctx.op.ruolo === 'LETTURA') return errore(403, 'FORBIDDEN', 'Il ruolo LETTURA può solo consultare gli allarmi.');
      var b = ctx.body;
      if (!b || typeof b !== 'object') return errore(400, 'BODY_REQUIRED', 'Serve un body JSON, es. { "stato": "RISOLTO", "note_risoluzione": "..." }');
      var dettagli = [];
      Object.keys(b).forEach(function (k) { if (k !== 'stato' && k !== 'note_risoluzione') dettagli.push({ field: k, issue: 'campo non modificabile. Campi ammessi: stato, note_risoluzione' }); });
      if (['RISOLTO', 'CHIUSO'].indexOf(b.stato) < 0) dettagli.push({ field: 'stato', issue: 'valori ammessi: RISOLTO (presa in carico), CHIUSO' });
      if (b.note_risoluzione !== undefined && typeof b.note_risoluzione !== 'string') dettagli.push({ field: 'note_risoluzione', issue: 'atteso string' });
      if (dettagli.length) return errore(422, 'VALIDATION_ERROR', 'Alcuni campi non sono validi.', dettagli);
      var a = r.a;
      if (a.stato === 'CHIUSO') return errore(409, 'ALARM_ALREADY_CLOSED', 'L\'allarme ' + a.id_allarme + ' è già chiuso.');
      if (b.stato === 'CHIUSO' && a.condizione_attiva) return errore(409, 'CONDITION_STILL_ACTIVE', 'Il valore è ancora fuori soglia: puoi prendere in carico l\'allarme (stato RISOLTO) ma non chiuderlo.');
      stato.allarmi[a.id_allarme] = { stato: b.stato, note: b.note_risoluzione || null, ts: oraSec(), operatore: ctx.op.nome, id_operatore: ctx.op.id };
      salvaStato();
      var agg = null; calcolaAllarmi().forEach(function (x) { if (x.id_allarme === a.id_allarme) agg = x; });
      return risposta(200, vistaAllarme(agg, true));
    } }
  ];
  function trovaAllarme(ctx) {
    var id = ctx.params.alarmId;
    if (!/^\d+$/.test(id)) return { r: errore(400, 'INVALID_PARAMETER', 'alarmId deve essere un numero intero.') };
    var a = null; calcolaAllarmi().forEach(function (x) { if (x.id_allarme === Number(id)) a = x; });
    if (!a) return { r: errore(404, 'ALARM_NOT_FOUND', 'L\'allarme ' + id + ' non esiste (o è più vecchio di 24 ore).') };
    if (!puoVedereNave(ctx.op, a.id_nave)) return { r: errore(403, 'SHIP_FORBIDDEN', 'L\'allarme appartiene a una nave che non puoi vedere.') };
    return { a: a };
  }

  function confronta(pattern, path) {
    var pp = pattern.split('/'), xs = path.split('/');
    if (pp.length !== xs.length) return null;
    var params = {};
    for (var i = 0; i < pp.length; i++) {
      if (pp[i].charAt(0) === '{') { if (!xs[i]) return null; params[pp[i].slice(1, -1)] = decodeURIComponent(xs[i]); }
      else if (pp[i] !== xs[i]) return null;
    }
    return params;
  }

  // ─── RATE LIMIT ────────────────────────────────────────────────────────────
  var storicoRichieste = {};
  function controllaRate(chiave) {
    var adesso = Date.now(), f = config.rateLimit.finestraMs;
    var arr = (storicoRichieste[chiave] = (storicoRichieste[chiave] || []).filter(function (t) { return adesso - t < f; }));
    if (arr.length >= config.rateLimit.max) return { superato: true, attesa: Math.ceil((f - (adesso - arr[0])) / 1000), rimaste: 0 };
    arr.push(adesso);
    return { superato: false, rimaste: config.rateLimit.max - arr.length };
  }

  // ─── IL "SERVER": da una richiesta HTTP a una risposta HTTP ────────────────
  function gestisci(req) {
    var path = req.path.replace(/\/+$/, '') || '/';
    var trovate = [], rotta = null, params = null;
    for (var i = 0; i < rotte.length; i++) {
      var p = confronta(rotte[i].p, path);
      if (p) { trovate.push(rotte[i].m); if (rotte[i].m === req.method) { rotta = rotte[i]; params = p; } }
    }
    if (!trovate.length) return errore(404, 'ROUTE_NOT_FOUND', 'Nessun endpoint corrisponde a ' + req.method + ' ' + path + '. Controlla l\'URL (maiuscole, plurali, /v1).');
    if (!rotta) return errore(405, 'METHOD_NOT_ALLOWED', 'Il metodo ' + req.method + ' non è ammesso su ' + path + '. Metodi ammessi: ' + trovate.join(', ') + '.', null, { 'Allow': trovate.join(', ') });

    var ctx = { params: params, query: req.query, headers: req.headers, body: undefined };
    if (req.bodyTesto) {
      var ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.indexOf('application/json') < 0) return errore(415, 'UNSUPPORTED_MEDIA_TYPE', 'Il body va inviato in JSON: aggiungi l\'header Content-Type: application/json (ricevuto: "' + (ct || 'nessuno') + '").');
      try { ctx.body = JSON.parse(req.bodyTesto); }
      catch (e) { return errore(400, 'INVALID_JSON', 'Il body non è JSON valido: ' + e.message, [{ field: 'body', issue: 'controlla virgolette doppie, virgole e parentesi' }]); }
    }
    var rate;
    if (!rotta.pubblica) {
      var a = autentica(req);
      if (a.r) return a.r;
      ctx.op = a.op; ctx.payload = a.payload;
      rate = controllaRate('op' + a.op.id);
    } else rate = controllaRate('anonimo');
    if (rate.superato) return errore(429, 'RATE_LIMITED', 'Troppe richieste: massimo ' + config.rateLimit.max + ' ogni ' + (config.rateLimit.finestraMs / 1000) + ' secondi. Riprova tra ' + rate.attesa + ' s.', null, { 'Retry-After': String(rate.attesa) });
    var res;
    try { res = rotta.h(ctx); }
    catch (e) { console.error(e); res = errore(500, 'INTERNAL_ERROR', 'Errore interno del server simulato: ' + e.message); }
    res.header['X-RateLimit-Limit'] = String(config.rateLimit.max);
    res.header['X-RateLimit-Remaining'] = String(rate.rimaste);
    return res;
  }

  // ─── INTERCETTAZIONE DI fetch() ────────────────────────────────────────────
  var ascoltatori = [];
  function emetti(ev) { ascoltatori.forEach(function (f) { try { f(ev); } catch (e) {} }); }
  function attendi(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var fetchOriginale = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;

  function urlDi(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.href === 'string') return input.href;
    if (input && typeof input.url === 'string') return input.url;
    return String(input);
  }

  function fetchNave(input, init) {
    var richiesta;
    try { richiesta = new Request(input, init); }
    catch (e) { return Promise.reject(e); } // es. GET con body: lo stesso errore del fetch vero
    var url = new URL(richiesta.url);
    var headers = {};
    richiesta.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    var query = {};
    url.searchParams.forEach(function (v, k) { query[k] = v; });
    var path = url.pathname.replace(/^\/v1/, '');
    var inizio = performance.now();
    var latenza = config.latenzaMin + Math.random() * (config.latenzaMax - config.latenzaMin);
    if (config.rete === 'lenta') latenza = latenza * 6 + 1500;

    var testo = '';
    return richiesta.text().then(function (t) {
      testo = t;
      return attendi(config.rete === 'offline' ? 1500 + Math.random() * 1500 : latenza).then(function () {
        if (config.rete === 'offline') {
          var err = new TypeError('Failed to fetch');
          emetti({ metodo: richiesta.method, url: richiesta.url, path: path, status: 0, ms: Math.round(performance.now() - inizio), errore: 'Rete non raggiungibile', headersRichiesta: headers, bodyRichiesta: testo || null });
          if (config.logConsole) console.log('%c[Nave] ' + richiesta.method + ' ' + url.pathname + url.search + ' → errore di rete', 'color:#c0392b');
          throw err;
        }
        if (url.pathname.indexOf('/v1') !== 0) {
          var r0 = errore(404, 'ROUTE_NOT_FOUND', 'Manca la versione dell\'API nel percorso: usa ' + BASE_URL + '/...');
          return costruisci(r0);
        }
        var res = gestisci({ method: richiesta.method.toUpperCase(), path: path, query: query, headers: headers, bodyTesto: testo });
        return costruisci(res);
      });
    });

    function costruisci(res) {
      var h = { 'X-Request-Id': idRichiesta(), 'Date': new Date().toUTCString() };
      var corpo = null;
      if (res.status !== 204 && res.corpo !== null) { corpo = JSON.stringify(res.corpo); h['Content-Type'] = 'application/json; charset=utf-8'; }
      for (var k in res.header) h[k] = res.header[k];
      var ms = Math.round(performance.now() - inizio);
      emetti({ metodo: richiesta.method, url: richiesta.url, path: path + url.search, status: res.status, ms: ms, headersRichiesta: headers, bodyRichiesta: testo || null, headersRisposta: h, bodyRisposta: corpo, byte: corpo ? utf8(corpo).length : 0 });
      if (config.logConsole) console.log('%c[Nave] ' + richiesta.method + ' ' + url.pathname + url.search + ' → ' + res.status + ' (' + ms + ' ms)', 'color:' + (res.status < 300 ? '#1e7d4f' : res.status < 500 ? '#b8620b' : '#c0392b'));
      return new Response(corpo, { status: res.status, statusText: TESTI_STATO[res.status] || '', headers: h });
    }
  }

  global.fetch = function (input, init) {
    var u = urlDi(input);
    if (u.indexOf(BASE_URL.replace('/v1', '')) === 0) return fetchNave(input, init);
    if (!fetchOriginale) return Promise.reject(new TypeError('fetch non disponibile'));
    return fetchOriginale(input, init);
  };

  // ─── API PUBBLICA DEL SIMULATORE ───────────────────────────────────────────
  global.Nave = {
    BASE_URL: BASE_URL,
    config: config,
    versione: '1.1',
    /** Registra una funzione chiamata a ogni richiesta (per log e strumenti) */
    onRichiesta: function (f) { ascoltatori.push(f); return function () { ascoltatori = ascoltatori.filter(function (x) { return x !== f; }); }; },
    /** Decodifica un JWT senza verificarlo (come jwt.io) */
    decodificaToken: decodificaJwt,
    /** Riporta la nave allo stato iniziale (soglie, allarmi presi in carico, logout) */
    reset: function () { stato = statoVuoto(); salvaStato(); },
    /** Vista "dall'interno" della nave, senza passare dall'API: per la plancia del docente e per verificare le missioni */
    interno: {
      navi: function () { return copia(NAVI); },
      sensori: function (idNave) {
        return SENSORI.filter(function (s) { return !idNave || s.id_nave === idNave; }).map(function (s) {
          var c = campiSensore(s); c.valore = valoreAl(s, ultimoIstante()); c.stato = statoSensore(s); return c;
        });
      },
      valoriRecenti: function (idSensore, secondi) {
        var s = sensoreDi(idSensore), fine = ultimoIstante(), out = [];
        for (var t = fine - (secondi || 60); t <= fine; t += PASSO) out.push(valoreAl(s, t));
        return out;
      },
      massimo: function (idSensore, secondi) {
        var s = sensoreDi(idSensore), fine = ultimoIstante(), mx = -Infinity;
        for (var t = fine - secondi; t <= fine; t += PASSO) mx = Math.max(mx, valoreAl(s, t));
        return mx;
      },
      allarmi: function (idNave) { return calcolaAllarmi().filter(function (a) { return !idNave || a.id_nave === idNave; }).map(copia); },
      soglie: function (idSensore) { var s = sensoreDi(idSensore); return sogliaAl(s, Infinity); },
      anteprima: function (idSensore, reg) {
        var s = sensoreDi(idSensore), fine = ultimoIstante(), att = sogliaAl(s, Infinity);
        var r = { min: reg.min !== undefined ? reg.min : att.min, max: reg.max !== undefined ? reg.max : att.max, ritardo: reg.ritardo || 0, isteresi: reg.isteresi || 0 };
        return episodi(s, fine - 86400, fine, function () { return r; }).length;
      },
      azioniAllarmi: function () { return copia(stato.allarmi); },
      operatori: function () { return OPERATORI.map(function (o) { return { email: o.email, password: o.password, ruolo: o.ruolo, nome: o.nome }; }); }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
