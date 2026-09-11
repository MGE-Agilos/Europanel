/* ══════════════════════════════════════════════════════════════════════
   Client minimal de l'Engine API de Qlik Cloud (JSON-RPC sur websocket).

   Pourquoi ce fichier existe : l'API REST de Qlik Cloud ne sait pas
   modifier un objet d'application — ni le titre d'un graphique, ni la
   dimension qu'il utilise, ni le script de chargement. Tout cela passe par
   l'Engine, en JSON-RPC sur websocket. Le connecteur MCP, de son cote, sait
   lire les objets et en creer de nouveaux, mais pas reecrire ceux qui
   existent.

   Node 22 fournit un WebSocket natif ; aucune dependance n'est ajoutee.

   L'objet n'est volontairement pas une bibliotheque generale : il expose
   ce dont les outils du depot ont besoin, et rien de plus.
   ══════════════════════════════════════════════════════════════════════ */

const OPEN_TIMEOUT_MS = 30000;
const CALL_TIMEOUT_MS = 120000;

export class QlikEngine {
  constructor(tenant, apiKey, appId) {
    this.url = 'wss://' + String(tenant).replace(/^https?:\/\//, '').replace(/\/+$/, '') +
               '/app/' + appId;
    this.apiKey = apiKey;
    this.appId = appId;
    this.seq = 0;
    this.pending = new Map();
    this.ws = null;
    this.docHandle = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url, { headers: { Authorization: 'Bearer ' + this.apiKey } });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Engine : pas de connexion en 30 s')),
                               OPEN_TIMEOUT_MS);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = e => { clearTimeout(timer); reject(new Error('Engine : ' + (e.message || 'erreur websocket'))); };
    });

    this.ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      // OnConnected et les autres notifications n'ont pas d'id : elles ne
      // repondent a aucun appel et seraient prises pour une reponse perdue.
      if (msg.id === undefined) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        waiter.reject(new Error('Engine ' + waiter.method + ' : ' +
          (msg.error.message || JSON.stringify(msg.error))));
      } else {
        waiter.resolve(msg.result);
      }
    };

    // Une fermeture cote serveur laisserait sinon chaque appel en cours
    // suspendu jusqu'a son propre delai, un par un.
    this.ws.onclose = ev => {
      for (const [, w] of this.pending) {
        w.reject(new Error('Engine : connexion fermee (' + ev.code + ') pendant ' + w.method));
      }
      this.pending.clear();
    };

    const doc = await this.call(-1, 'OpenDoc', [this.appId]);
    this.docHandle = doc.qReturn.qHandle;
    return this;
  }

  call(handle, method, params = []) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Engine ' + method + ' : pas de reponse en 120 s'));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {
        method,
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method, params }));
    });
  }

  doc(method, params) { return this.call(this.docHandle, method, params); }

  /* ── Objets ──────────────────────────────────────────────────────── */

  async allInfos() {
    const r = await this.doc('GetAllInfos', []);
    return r.qInfos || [];
  }

  async handleOf(id) {
    const r = await this.doc('GetObject', [id]);
    if (!r.qReturn || !r.qReturn.qHandle) throw new Error('objet introuvable : ' + id);
    return r.qReturn.qHandle;
  }

  async properties(id) {
    const h = await this.handleOf(id);
    const r = await this.call(h, 'GetProperties', []);
    return { handle: h, props: r.qProp };
  }

  async setProperties(handle, props) {
    return this.call(handle, 'SetProperties', [props]);
  }

  /* ── Script de chargement ────────────────────────────────────────── */

  async getScript() {
    const r = await this.doc('GetScript', []);
    return r.qScript;
  }

  async setScript(script) {
    return this.doc('SetScript', [script]);
  }

  /* ── Persistance ─────────────────────────────────────────────────── */

  // Sans DoSave, toute modification vit dans la session et disparait a la
  // fermeture du websocket : l'application semblerait inchangee.
  async save() { return this.doc('DoSave', ['']); }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

export async function openEngine(tenant, apiKey, appId) {
  return new QlikEngine(tenant, apiKey, appId).connect();
}
