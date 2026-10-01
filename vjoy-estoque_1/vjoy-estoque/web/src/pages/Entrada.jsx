import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Scanner from '../components/Scanner.jsx';
import { Resultado, useDialog } from '../components/ui.jsx';
import { get, post, ApiError } from '../api.js';
import { feedback } from '../feedback.js';
import { tratarCodigoDesconhecido, dicaSemPermissao } from '../components/codigoDesconhecido.js';
import { useAuth } from '../auth.jsx';
import { fmtDataHora } from '../util.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const lerRecentes = () => { try { return JSON.parse(localStorage.getItem('vjoy_clientes_recentes') || '[]'); } catch { return []; } };
const salvarRecente = (id) => { try { localStorage.setItem('vjoy_clientes_recentes', JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 6))); } catch {} };
const ruaTexto = (c) => (c?.rua ? `RUA ${c.rua}` : 'Sem rua definida');

/** Passo 1: escolher o cliente pelo NOME (sem etiqueta). Também aceita o código, se alguém bipar. */
function EscolherCliente({ clientes, onEscolher }) {
  const [texto, setTexto] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const t = norm(texto);
  const lista = useMemo(() => {
    if (!t) { const rec = lerRecentes(); return rec.map((id) => clientes.find((c) => c.id === id)).filter(Boolean); }
    return clientes.filter((c) => norm(c.nome).includes(t) || c.codigo === t || c.codigo_barras === t || (c.aliases || []).some((a) => a.includes(t))).slice(0, 8);
  }, [t, clientes]);
  const exato = clientes.find((c) => norm(c.nome) === t || c.codigo_barras === t || c.codigo === t);
  const escolher = (c) => { setTexto(''); onEscolher(c); };
  return (
    <div className="scanner scanner-grande">
      <div className="scanner-titulo">CLIENTE</div>
      <form className="scanner-linha" onSubmit={(e) => { e.preventDefault(); if (exato) escolher(exato); else if (lista.length === 1) escolher(lista[0]); }}>
        <input ref={ref} id="cliente-nome" className="scanner-input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Digite o nome do cliente…" autoComplete="off" autoCapitalize="characters" aria-label="Nome do cliente" />
      </form>
      {!t && lista.length > 0 && <div className="muted pequeno" style={{ marginTop: 8 }}>Usados recentemente</div>}
      <div className="lista-clientes">
        {lista.map((c) => (
          <button key={c.id} type="button" className="item-cliente" onClick={() => escolher(c)}>
            <b>{c.nome}</b><span className="muted pequeno">{c.rua ? `📍 ${c.rua}` : 'sem rua'} · {c.codigo}</span>
          </button>
        ))}
        {t.length >= 3 && !exato && (
          <button type="button" className="item-cliente novo" onClick={() => escolher({ id: null, nome: t, novo: true })}>
            <b>➕ Usar novo cliente: {t}</b><span className="muted pequeno">Será cadastrado na primeira entrada</span>
          </button>
        )}
        {t && !lista.length && t.length < 3 && <div className="muted pequeno">Continue digitando…</div>}
      </div>
    </div>
  );
}

export default function Entrada() {
  const dialog = useDialog();
  const { pode } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [cliente, setCliente] = useState(null);
  const [res, setRes] = useState(null);
  const [qtd, setQtd] = useState(1);
  const [recentes, setRecentes] = useState([]);

  const carregarClientes = useCallback(() => get('/clientes').then((l) => setClientes(l.filter((c) => c.status === 'ATIVO'))).catch(() => {}), []);
  const carregarRecentes = useCallback(() => get('/entrada/recentes').then(setRecentes).catch(() => {}), []);
  useEffect(() => { carregarClientes(); carregarRecentes(); }, [carregarClientes, carregarRecentes]);

  const mostrar = (nivel, titulo, linhas = [], sub) => {
    feedback(nivel);
    setRes({ nivel, titulo, linhas, chave: Date.now() });
    return { nivel, titulo, sub: sub ?? (typeof linhas[0] === 'string' ? linhas[0] : linhas[0]?.texto) };
  };

  const escolherCliente = (c) => {
    setCliente(c); setRes(null);
    if (c.id) salvarRecente(c.id);
    feedback('SUCESSO');
  };

  const registrar = async (cli, codigo, extra = {}) => {
    try {
      const r = await post('/entrada', { ...(cli.id ? { cliente_id: cli.id } : { cliente_nome: cli.nome }), produto: codigo, quantidade: qtd, ...extra });
      setQtd(1);
      carregarRecentes();
      if (!cli.id) { // cliente novo: passa a existir
        const novo = { ...r.cliente, status: 'ATIVO' };
        setCliente(novo); salvarRecente(novo.id); carregarClientes();
      }
      const linhas = [
        { texto: r.produto.codigo, destaque: true },
        r.produto.descricao,
        `${r.quantidade > 1 ? r.quantidade + ' unidades · ' : ''}Cliente: ${r.cliente.nome}`,
        r.cliente.rua ? `📍 Coloque na RUA ${r.cliente.rua}` : null,
        r.pedido ? `Pedido ${r.pedido.numero}: ${r.pedido.recebido}/${r.pedido.pedida} recebidos` : 'Sem pedido em aberto para este produto',
      ];
      return mostrar(r.nivel, r.nivel === 'SUCESSO' ? 'NO ESTOQUE' : 'REGISTRADO COM ALERTA', r.nivel === 'ALERTA' ? [r.mensagem, ...linhas] : linhas, `${r.produto.codigo} · ${r.produto.descricao}`);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.codigo === 'CONFIRMAR') return tratarConfirmacao(cli, codigo, e, extra);
      if (e.status === 403 && extra.autorizacao) return mostrar('ERRO', 'AUTORIZAÇÃO RECUSADA', [e.message]);
      if (e.codigo === 'CODIGO_INEXISTENTE') {
        feedback('ERRO');
        if (await tratarCodigoDesconhecido({ dialog, pode, codigo, permitirNovo: true })) return registrar(cli, codigo, extra);
        return mostrar('ERRO', 'CÓDIGO NÃO CADASTRADO', [`Código lido: ${codigo.toUpperCase()}`, pode('cadastros') ? 'Nenhum produto vinculado. Bipe de novo para vincular.' : dicaSemPermissao(codigo.toUpperCase())], `Lido: ${codigo.toUpperCase()}`);
      }
      return mostrar('ERRO', 'ERRO NA ENTRADA', [e.message]);
    }
  };

  const tratarConfirmacao = async (cli, codigo, e, extra) => {
    feedback('ALERTA');
    const d = e.dados || {};
    const sugeridos = d.clientesSugeridos || [];
    const trocas = sugeridos.map((s) => ({ valor: 'trocar:' + s.cliente_id, texto: `Trocar para ${s.nome}${s.rua ? ' (' + s.rua + ')' : ''}`, classe: 'btn-primario' }));
    const titulos = { EXCEDENTE: 'Quantidade acima do pedido', CLIENTE_DIVERGENTE: 'Cliente diferente do pedido' };
    const escolha = await dialog({
      titulo: '⚠️ ATENÇÃO — ' + (titulos[d.tipo] || 'Confirme'),
      mensagem: <><p>{e.message}</p>{d.tipo === 'CLIENTE_DIVERGENTE' && <p><b>Deseja continuar com {cli.nome}?</b> Exige autorização.</p>}</>,
      confirmar: d.tipo === 'CLIENTE_DIVERGENTE' ? `Continuar com ${cli.nome}` : 'Registrar mesmo assim',
      extras: trocas,
    });
    if (!escolha) return mostrar('ALERTA', 'ENTRADA NÃO REGISTRADA', ['Operação cancelada pelo operador.']);
    if (typeof escolha === 'string' && escolha.startsWith('trocar:')) {
      const novo = clientes.find((c) => c.id === +escolha.slice(7)) || { id: +escolha.slice(7), nome: sugeridos.find((s) => s.cliente_id === +escolha.slice(7))?.nome };
      setCliente(novo); salvarRecente(novo.id);
      return registrar(novo, codigo);
    }
    let autorizacao;
    if (d.precisaAutorizacao) {
      autorizacao = await dialog({ tipo: 'autorizacao', mensagem: `Registrar ${codigo} no cliente ${cli.nome} apesar da divergência.` });
      if (!autorizacao) return mostrar('ALERTA', 'ENTRADA NÃO REGISTRADA', ['Autorização cancelada.']);
    }
    return registrar(cli, codigo, { ...extra, confirmar: d.tipo, autorizacao });
  };

  return (
    <div className="pagina pagina-op">
      <div className="passos">
        <div className={'passo ' + (cliente ? 'feito' : 'ativo')}><span>1</span> Cliente</div>
        <div className={'passo ' + (cliente ? 'ativo' : '')}><span>2</span> Bipar produto</div>
        <div className="passo"><span>✓</span> No estoque</div>
      </div>

      {!cliente ? (
        <EscolherCliente clientes={clientes} onEscolher={escolherCliente} />
      ) : (
        <>
          <div className="cliente-card">
            <div>
              <div className="cliente-nome">{cliente.nome}</div>
              <div className="muted">{cliente.novo ? 'cliente novo' : cliente.codigo}</div>
            </div>
            {cliente.rua ? <div className="rua-grande"><small>RUA</small>{cliente.rua}</div> : <div className="muted pequeno">{ruaTexto(cliente)}</div>}
            <button className="btn btn-leve" onClick={() => { setCliente(null); setRes(null); }}>Trocar cliente</button>
          </div>
          <Scanner titulo="BIPAR PRODUTO" placeholder="Código de barras do produto…" onLeitura={(codigo) => registrar(cliente, codigo)} />
          <div className="qtd-linha">
            <span>Quantidade por leitura</span>
            <div className="stepper">
              <button className="btn btn-leve" onClick={() => setQtd((q) => Math.max(1, q - 1))} aria-label="Menos">−</button>
              <b>{qtd}</b>
              <button className="btn btn-leve" onClick={() => setQtd((q) => Math.min(500, q + 1))} aria-label="Mais">+</button>
            </div>
          </div>
        </>
      )}

      <Resultado r={res} />

      <h3 className="sec">Minhas últimas entradas</h3>
      <div className="lista-cartoes">
        {recentes.length === 0 && <div className="vazio">Nenhuma entrada registrada ainda.</div>}
        {recentes.map((r) => (
          <div key={r.id + r.codigo} className={'mini-cartao' + (r.excedente ? ' alerta' : '')}>
            <div><b>{r.codigo}</b> <span className="muted">×{r.qtd}</span> {r.excedente && <span className="badge badge-amarelo">sobra</span>}</div>
            <div className="pequeno">{r.descricao}</div>
            <div className="muted pequeno">{r.cliente}{r.rua ? <> · <b>{r.rua}</b></> : ''} · {r.pedido ? 'Pedido ' + r.pedido : 'sem pedido'} · {fmtDataHora(r.criado_em)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
