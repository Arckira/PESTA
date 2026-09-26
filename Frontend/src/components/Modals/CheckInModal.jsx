import { useState } from 'react'
import { User, Cpu, Folder, FlaskConical, Clock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useLanguage } from '../../contexts/useLanguage.js'
import styles from './CheckInModal.module.css'

function minutosParaValorUnidade(minutos) {
  if (!minutos || minutos <= 0) return { valor: '', unidade: 'horas' }
  const horas = minutos / 60
  if (horas >= 24 && horas % 24 === 0) return { valor: String(horas / 24), unidade: 'dias' }
  return { valor: String(horas % 1 === 0 ? horas : horas.toFixed(1)), unidade: 'horas' }
}

export default function CheckInModal({
  equipamentoNome,
  equipamentoCodigo,
  modoEdicao,
  duracaoInicialMinutos,
  onConfirmar,
  onClose,
  saving,
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [projeto, setProjeto] = useState('')
  const [metodo, setMetodo] = useState('')

  const inicial = minutosParaValorUnidade(duracaoInicialMinutos)
  const [duracaoValor, setDuracaoValor] = useState(inicial.valor)
  const [duracaoUnidade, setDuracaoUnidade] = useState(inicial.unidade)

  const raw = parseFloat(String(duracaoValor).replace(',', '.'))
  const duracaoMinutos = !isNaN(raw) && raw > 0
    ? Math.max(1, Math.round(raw * (duracaoUnidade === 'dias' ? 1440 : 60)))
    : 0
  const duracaoValida = duracaoMinutos > 0

  const podeConfirmar = modoEdicao
    ? duracaoValida && !saving
    : projeto.trim() !== '' && metodo.trim() !== '' && duracaoValida && !saving

  const handleClose = () => {
    if (!saving) onClose()
  }

  const handleConfirmar = () => {
    if (!podeConfirmar) return
    onConfirmar({
      projeto: projeto.trim() || null,
      metodo: metodo.trim() || null,
      duracaoMinutos,
    })
  }

  const duracaoHint = (() => {
    if (!duracaoValida) return null
    const totalH = duracaoMinutos / 60
    const dias = Math.floor(totalH / 24)
    const hRest = totalH % 24
    if (dias > 0 && hRest === 0) return `${dias} ${dias > 1 ? t('checkin.hintDias') : t('checkin.hintDia')}`
    if (dias > 0) return `${dias}d ${hRest}h`
    const h = Math.floor(totalH)
    const m = duracaoMinutos % 60
    if (h === 0) return `${m} min`
    if (m === 0) return `${h}h`
    return `${h}h ${m}min`
  })()

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className="label" style={{ marginBottom: 6 }}>{t('checkin.eyebrow')}</div>
        <h2 className={styles.modalTitle}>
          {modoEdicao ? t('checkin.tituloEditar') : t('checkin.tituloNovo')}
        </h2>

        <div className={styles.infoAlert}>
          <span className={styles.infoAlertIcon}>i</span>
          <span>{t('checkin.infoOEE')}</span>
        </div>

        <div className={styles.fields}>
          {/* Utilizador — somente leitura, pessoal e intransmissível */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              <User size={14} className={styles.fieldIcon} />
              {t('checkin.utilizador')}
            </span>
            <div className={styles.readonlyField}>
              <span className={styles.readonlyValue}>{user?.nome || '—'}</span>
              {user?.departamento && (
                <span className={styles.readonlyHint}>· {user.departamento}</span>
              )}
            </div>
          </div>

          {/* Equipamento — validado pelo scan QR, não editável */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              <Cpu size={14} className={styles.fieldIcon} />
              {t('checkin.equipamento')}
            </span>
            <div className={styles.readonlyField}>
              {equipamentoCodigo && (
                <span className={styles.readonlyCode}>{equipamentoCodigo}</span>
              )}
              <span className={styles.readonlyValue}>{equipamentoNome || '—'}</span>
            </div>
          </div>

          {/* Projeto — obrigatório em novo check-in */}
          {!modoEdicao && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <Folder size={14} className={styles.fieldIcon} />
                {t('checkin.projeto')} *
              </span>
              <input
                className={styles.input}
                placeholder={t('checkin.projetoPlaceholder')}
                value={projeto}
                onChange={(e) => setProjeto(e.target.value)}
                autoFocus
              />
            </label>
          )}

          {/* Método de Ensaio — obrigatório em novo check-in */}
          {!modoEdicao && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <FlaskConical size={14} className={styles.fieldIcon} />
                {t('checkin.metodo')} *
              </span>
              <input
                className={styles.input}
                placeholder={t('checkin.metodoPlaceholder')}
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
              />
            </label>
          )}

          {/* Duração Estimada */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              <Clock size={14} className={styles.fieldIcon} />
              {t('checkin.duracao')} *
            </span>
            <div className={styles.duracaoWrap}>
              <input
                type="number"
                className={styles.input}
                placeholder={t('checkin.duracaoValorPlaceholder')}
                min="1"
                step="1"
                value={duracaoValor}
                onChange={(e) => setDuracaoValor(e.target.value)}
              />
              <select
                className={`${styles.input} ${styles.unidadeSelect}`}
                value={duracaoUnidade}
                onChange={(e) => setDuracaoUnidade(e.target.value)}
              >
                <option value="horas">{t('checkin.unidadeHoras')}</option>
                <option value="dias">{t('checkin.unidadeDias')}</option>
              </select>
            </div>
            {duracaoHint && (
              <span className={styles.duracaoHint}>≈ {duracaoHint}</span>
            )}
          </div>
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.btnSecondary}
            onClick={handleClose}
            disabled={saving}
          >
            {t('common.cancel')}
          </button>
          <button
            className={modoEdicao ? styles.btnAmber : styles.btnGreen}
            onClick={handleConfirmar}
            disabled={!podeConfirmar}
          >
            {saving
              ? modoEdicao ? t('checkin.aGuardar') : t('checkin.aIniciar')
              : modoEdicao ? t('checkin.guardarAlteracoes') : t('checkin.confirmar')}
          </button>
        </div>
      </div>
    </div>
  )
}
