import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge from '../components/StatusBadge.jsx'
import styles from './DetalheEquipamento.module.css'

const ESTADOS = ['Em funcionamento','NOK','Ocupado','Em calibração','Em manutenção']

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

export default function DetalheEquipamento() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [eq, setEq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [avarias, setAvarias] = useState([])
  const [manutencoes, setManutencoes] = useState([])
  const [calibracoes, setCalibracoes] = useState([])
  const [tab, setTab] = useState('avarias')

  // Estado modal
  const [modalEstado, setModalEstado] = useState(false)
  const [novoEstado, setNovoEstado] = useState('')
  const [savingEstado, setSavingEstado] = useState(false)

  // Avaria modal
  const [modalAvaria, setModalAvaria] = useState(false)
  const [descAvaria, setDescAvaria] = useState('')
  const [savingAvaria, setSavingAvaria] = useState(false)
  const [msgAvaria, setMsgAvaria] = useState('')

  const carregar = async () => {
    setLoading(true)
    try {
      const [eqData, av, mn, cal] = await Promise.all([
        api.detalheEquipamento(id),
        api.listarAvarias(id),
        api.listarManutencoes(id),
        api.listarCalibracoes(id),
      ])
      setEq(eqData)
      setNovoEstado(eqData.estado_atual)
      setAvarias(av)
      setManutencoes(mn)
      setCalibracoes(cal)
    } catch (e) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [id])

  const handleEstado = async () => {
    setSavingEstado(true)
    try {
      await api.atualizarEstado(id, novoEstado)
      setModalEstado(false)
      carregar()
    } catch (e) { alert(e.message) }
    finally { setSavingEstado(false) }
  }

  const handleAvaria = async () => {
    if (!descAvaria.trim()) return
    setSavingAvaria(true)
    try {
      const res = await api.registarAvaria(id, descAvaria)
      setMsgAvaria(res.mensagem || 'Avaria registada!')
      setDescAvaria('')
      setTimeout(() => { setModalAvaria(false); setMsgAvaria(''); carregar() }, 1400)
    } catch (e) { alert(e.message) }
    finally { setSavingAvaria(false) }
  }
  
  const handleCheckin = async () => {
    const utilizador = prompt("Nome do Operador:");
    if (!utilizador) return;

    try {
      await api.iniciarCheckin(id, utilizador);
      carregar();
    } catch (e) { alert("Erro no Check-in: " + e.message); }
  };

  const handleCheckout = async () => {
    if (!confirm("Tem a certeza que deseja terminar o trabalho e libertar a máquina?")) return;
    try {
      await api.terminarCheckout(id);
      carregar();
    } catch (e) { alert("Erro no Check-out: " + e.message); }
  };

  if (loading) return <div className={styles.loading}>A carregar…</div>
  if (erro)    return <div className={styles.erro}>Erro: {erro}</div>
  if (!eq)     return null

  const avariaAbertas = avarias.filter(a => !a.resolvida).length

  return (
    <div className="fade-up">
      <div className={styles.breadcrumb}>
        <button onClick={() => navigate('/equipamentos')} className={styles.back}>← Equipamentos</button>
        <span className={styles.sep}>/</span>
        <span style={{ color: 'var(--text-secondary)' }}>{eq.nome}</span>
      </div>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 6 }}>
            EQ-{String(eq.id).padStart(3, '0')}
          </div>
          <h1 className={styles.title}>{eq.nome}</h1>
          <div className={styles.subInfo}>
            <span>{eq.tipo}</span>
            <span className={styles.dot}>·</span>
            <span>{eq.localizacao}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <StatusBadge estado={eq.estado_atual} />
        </div>
      </div>

      {/* DADOS TÉCNICOS */}
      <div className={styles.infoGrid}>
        <div className={styles.infoCard}>
          <div className="label">Estado Atual</div>
          <div className={styles.infoValue}><StatusBadge estado={eq.estado_atual} /></div>
        </div>
        <div className={styles.infoCard}>
          <div className="label">Tipo</div>
          <div className={styles.infoValue}>{eq.tipo}</div>
        </div>
        <div className={styles.infoCard}>
          <div className="label">Localização</div>
          <div className={styles.infoValue}>{eq.localizacao}</div>
        </div>
        <div className={styles.infoCard}>
          <div className="label">Registado em</div>
          <div className={styles.infoValue} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {new Date(eq.criado_em).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* CONTROLO DE UTILIZAÇÃO REAL (OEE) */}
      <div className={styles.section}>
        <div className="label" style={{ marginBottom: 14 }}>Controlo de Utilização (OEE)</div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
          Registe o início e fim da operação no equipamento para cálculo de eficiência laboratorial.
        </p>
        <div className={styles.acoes}>
          <button 
            className={styles.btnAmber} 
            style={{ backgroundColor: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}
            onClick={handleCheckin} 
          >
            ▶ Iniciar Check-in
          </button>
          <button 
            className={styles.back} 
            style={{ backgroundColor: '#334155', color: 'white' }}
            onClick={handleCheckout}
          >
            ■ Terminar Trabalho
          </button>
        </div>
      </div>

      {/* AÇÕES MANUAIS */}
      <div className={styles.section}>
        <div className="label" style={{ marginBottom: 14 }}>Ações</div>
        <div className={styles.acoes}>
          <button className={styles.btnAmber} onClick={() => setModalEstado(true)}>⟳ Atualizar Estado</button>
          <button className={styles.btnRed} onClick={() => setModalAvaria(true)}>⚠ Registar Avaria</button>
        </div>
      </div>

      {/* TABS: HISTÓRICO */}
      <div className={styles.section}>
        <div className={styles.tabs}>
          {[
            ['avarias',     `Avarias${avariaAbertas > 0 ? ` (${avariaAbertas} abertas)` : ` (${avarias.length})`}`],
            ['manutencoes', `Manutenções (${manutencoes.length})`],
            ['calibracoes', `Calibrações (${calibracoes.length})`],
          ].map(([key, label]) => (
            <button key={key} className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {/* CONTEÚDO DAS TABS */}
        
        {/* Avarias tab */}
        {tab === 'avarias' && (
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Descrição</th><th>Data</th><th>Estado</th><th>Resolução</th></tr></thead>
            <tbody>
              {avarias.map(av => (
                <tr key={av.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(av.id).padStart(3,'0')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{av.descricao}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_registo)}</td>
                  <td>{av.resolvida ? <span className="badge badge-ok">Resolvida</span> : <span className="badge badge-nok">Aberta</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{av.notas_resolucao || '—'}</td>
                </tr>
              ))}
              {avarias.length === 0 && <tr><td colSpan={5} className={styles.empty}>Sem avarias registadas.</td></tr>}
            </tbody>
          </table>
        )}

        {/* Manutenções tab */}
        {tab === 'manutencoes' && (
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Descrição</th><th>Data Realizada</th><th>Próxima</th></tr></thead>
            <tbody>
              {manutencoes.map(mn => (
                <tr key={mn.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(mn.id).padStart(3,'0')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{mn.descricao}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(mn.data_realizada)}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(mn.proxima_data)}</td>
                </tr>
              ))}
              {manutencoes.length === 0 && <tr><td colSpan={4} className={styles.empty}>Sem manutenções registadas.</td></tr>}
            </tbody>
          </table>
        )}

        {/* Calibrações tab */}
        {tab === 'calibracoes' && (
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Data Realizada</th><th>Próxima</th><th>Certificado</th></tr></thead>
            <tbody>
              {calibracoes.map(cal => (
                <tr key={cal.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(cal.id).padStart(3,'0')}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(cal.data_realizada)}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(cal.proxima_data)}</td>
                  <td>{cal.certificado_url ? <a href={cal.certificado_url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12 }}>Ver →</a> : '—'}</td>
                </tr>
              ))}
              {calibracoes.length === 0 && <tr><td colSpan={4} className={styles.empty}>Sem calibrações registadas.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Atualizar Estado */}
      {modalEstado && (
        <div className={styles.overlay} onClick={() => setModalEstado(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 8 }}>Equipamento</div>
            <h2 className={styles.modalTitle}>Atualizar Estado</h2>
            <p className={styles.modalDesc}>Estado atual: <StatusBadge estado={eq.estado_atual} /></p>
            <div className={styles.stateOptions}>
              {ESTADOS.map(e => (
                <label key={e} className={`${styles.stateOpt} ${novoEstado === e ? styles.stateOptActive : ''}`}>
                  <input type="radio" name="estado" value={e} checked={novoEstado === e} onChange={() => setNovoEstado(e)} style={{ display: 'none' }} />
                  <StatusBadge estado={e} />
                </label>
              ))}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModalEstado(false)}>Cancelar</button>
              <button className={styles.btnAmber} onClick={handleEstado} disabled={savingEstado || novoEstado === eq.estado_atual}>
                {savingEstado ? 'A guardar…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registar Avaria */}
      {modalAvaria && (
        <div className={styles.overlay} onClick={() => setModalAvaria(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 8 }}>Avaria</div>
            <h2 className={styles.modalTitle} style={{ color: 'var(--red)' }}>Registar Avaria</h2>
            <p className={styles.modalDesc}>O equipamento passará automaticamente para estado <strong>NOK</strong>.</p>
            {msgAvaria
              ? <div className={styles.sucesso}>{msgAvaria}</div>
              : <textarea className={styles.textarea} rows={4} placeholder="Descreve o problema detectado…" value={descAvaria} onChange={e => setDescAvaria(e.target.value)} />
            }
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setModalAvaria(false); setDescAvaria('') }}>Cancelar</button>
              {!msgAvaria && (
                <button className={styles.btnRed} onClick={handleAvaria} disabled={savingAvaria || !descAvaria.trim()}>
                  {savingAvaria ? 'A registar…' : '⚠ Registar Avaria'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}