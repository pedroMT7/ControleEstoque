import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { STATUS } from '../util.js';
import { get, post } from '../api.js';

export function Resultado({ r }) {
  if (!r) return null;
  const cls = { SUCESSO: 'ok', ERRO: 'erro', ALERTA: 'alerta' }[r.nivel] || 'ok';
  const ic = { SUCESSO: '✓', ERRO: '❌', ALERTA: '⚠️' }[r.nivel] || '✓';
  return (
    <div className={'resultado ' + cls} role="status" aria-live="assertive" key={r.chave}>
      <div className="resultado-titulo"><span className="resultado-icone">{ic}</span> {r.titulo}</div>
      {r.linhas?.filter(Boolean).map((l, i) => <div key={i} className={'resultado-linha' + (l.destaque ? ' destaque' : '')}>{l.texto ?? l}</div>)}
    </div>
  );
}

export const Badge = ({ status }) => {
  const [t, c] = STATUS[status] || [status, 'cinza'];
  return <span className={'badge badge-' + c}>{t}</span>;
};

export function Modal({ titulo, children, onFechar, rodape, largo, tom }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onFechar?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onFechar]);
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar?.()}>
      <div className={'modal' + (largo ? ' modal-largo' : '') + (tom ? ' modal-' + tom : '')} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cabeca"><h3>{titulo}</h3>{onFechar && <button className="btn-x" onClick={onFechar} aria-label="Fechar">✕</button>}</div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

// ---------- confirmação / autorização baseadas em Promise (funcionam por cima da câmera)
const DialogCtx = createContext(null);
export function DialogProvider({ children }) {
  const [d, setD] = useState(null);
  const abrir = useCallback((cfg) => new Promise((resolve) => setD({ ...cfg, resolve })), []);
  const fechar = (v) => { d?.resolve(v); setD(null); };
  return (
    <DialogCtx.Provider value={abrir}>
      {children}
      {d && (d.tipo === 'autorizacao' ? <AutorizacaoModal {...d} onFim={fechar} /> : d.tipo === 'vincular' ? <VincularCodigoModal {...d} onFim={fechar} /> : <ConfirmModal {...d} onFim={fechar} />)}
    </DialogCtx.Provider>
  );
}
export const useDialog = () => useContext(DialogCtx);

function ConfirmModal({ titulo, mensagem, confirmar = 'Confirmar', cancelar = 'Cancelar', tom = 'alerta', extras = [], campo, onFim }) {
  const [texto, setTexto] = useState('');
  const ok = () => onFim(campo ? { texto: texto.trim() } : true);
  return (
    <Modal titulo={titulo} tom={tom} onFechar={() => onFim(false)}
      rodape={<>
        <button className="btn btn-leve" onClick={() => onFim(false)}>{cancelar}</button>
        {extras.map((x) => <button key={x.valor} className={'btn ' + (x.classe || 'btn-secundario')} onClick={() => onFim(x.valor)}>{x.texto}</button>)}
        {confirmar && <button className={'btn ' + (tom === 'erro' ? 'btn-perigo' : tom === 'ok' ? 'btn-sucesso' : 'btn-alerta')} autoFocus={!campo} disabled={!!campo && texto.trim().length < (campo.minimo ?? 1)} onClick={ok}>{confirmar}</button>}
      </>}>
      <div className="confirm-msg">{mensagem}</div>
      {campo && <div className="form"><label>{campo.rotulo}<textarea id="dialogo-campo" rows={2} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} /></label></div>}
    </Modal>
  );
}

/** Liga um código de barras lido (de outro sistema) a um produto cadastrado */
function VincularCodigoModal({ codigo, onFim }) {
  const [busca, setBusca] = useState(''), [lista, setLista] = useState([]), [sel, setSel] = useState(null), [erro, setErro] = useState(''), [env, setEnv] = useState(false);
  useEffect(() => {
    if (busca.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => get('/produtos?busca=' + encodeURIComponent(busca.trim())).then((r) => setLista(r.slice(0, 30))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca]);
  const salvar = async () => {
    setEnv(true); setErro('');
    try { await post('/produtos/codigos', { produto_id: sel.id, codigo, origem: 'BIPAGEM' }); onFim(sel); }
    catch (e) { setErro(e.message); } finally { setEnv(false); }
  };
  return (
    <Modal titulo="Vincular código de barras" onFechar={() => onFim(null)}
      rodape={<><button className="btn btn-leve" onClick={() => onFim(null)}>Cancelar</button><button className="btn btn-primario" disabled={!sel || env} onClick={salvar}>{env ? 'Salvando…' : sel ? `Vincular a ${sel.codigo}` : 'Escolha o produto'}</button></>}>
      <p>Código lido: <b className="codigo-lido">{codigo}</b></p>
      <p className="muted pequeno">Escolha a qual produto esta etiqueta pertence. Depois disso, o código é reconhecido em todas as telas.</p>
      <div className="form">
        <label>Buscar produto (código ou descrição)<input id="vincular-busca" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: BBD079 ou BAU PLUS" /></label>
      </div>
      <div className="lista-vincular">
        {lista.map((p) => (
          <button key={p.id} type="button" className={'item-vincular' + (sel?.id === p.id ? ' sel' : '')} onClick={() => setSel(p)}>
            <b>{p.codigo}</b><span className="muted pequeno">{p.descricao}</span>
          </button>
        ))}
        {busca.trim().length >= 2 && !lista.length && <div className="vazio">Nenhum produto encontrado.</div>}
      </div>
      {erro && <div className="erro-box">{erro}</div>}
    </Modal>
  );
}

function AutorizacaoModal({ titulo = 'Autorização necessária', mensagem, onFim }) {
  const [login, setLogin] = useState(''), [senha, setSenha] = useState('');
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Modal titulo={titulo} tom="alerta" onFechar={() => onFim(null)}
      rodape={<>
        <button className="btn btn-leve" onClick={() => onFim(null)}>Cancelar</button>
        <button className="btn btn-alerta" disabled={!login || !senha} onClick={() => onFim({ login, senha })}>Autorizar</button>
      </>}>
      <div className="confirm-msg">{mensagem}</div>
      <p className="muted">Um usuário <b>Administrador</b> ou <b>Gestão</b> deve informar login e senha.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (login && senha) onFim({ login, senha }); }}>
        <label>Login<input ref={ref} value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoComplete="off" /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" /></label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------- toasts
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState([]);
  const add = useCallback((msg, nivel = 'SUCESSO') => {
    const id = Math.random();
    setT((x) => [...x, { id, msg, nivel }]);
    setTimeout(() => setT((x) => x.filter((y) => y.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="toasts">{t.map((x) => <div key={x.id} className={'toast ' + ({ SUCESSO: 'ok', ERRO: 'erro', ALERTA: 'alerta' }[x.nivel])}>{x.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export const Carregando = ({ texto = 'Carregando…' }) => <div className="carregando"><span className="spinner" /> {texto}</div>;
export const Vazio = ({ children }) => <div className="vazio">{children}</div>;
export const ErroBox = ({ erro }) => erro ? <div className="erro-box">❌ {erro.message || String(erro)}</div> : null;

export function Progresso({ feito, total }) {
  const p = total ? Math.min(100, Math.round((feito / total) * 100)) : 0;
  return <div className="progresso" aria-label={`${feito} de ${total}`}><div className={'progresso-barra' + (feito >= total && total ? ' completo' : '')} style={{ width: p + '%' }} /></div>;
}

/** Hook de carregamento simples */
export function useCarregar(fn, deps = []) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const fnRef = useRef(fn); fnRef.current = fn;
  const recarregar = useCallback(async (silencioso) => {
    if (!silencioso) setEstado((e) => ({ ...e, carregando: true }));
    try { const d = await fnRef.current(); setEstado({ dados: d, erro: null, carregando: false }); return d; }
    catch (e) { setEstado((s) => ({ ...s, erro: e, carregando: false })); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recarregar(); }, deps);
  return { ...estado, recarregar };
}
