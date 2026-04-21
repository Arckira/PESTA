import styles from './SessionModal.module.css'

function formatRole(user) {
  const dep = (user?.departamento || '').trim()
  if (!dep) return 'Operador'
  if (/admin/i.test(dep)) return 'Admin'
  return dep
}

export default function SessionModal({
  open,
  users,
  loading,
  activeUser,
  onSelect,
  onClose,
  canClose,
}) {
  if (!open) return null

  return (
    <div className={styles.overlay} onClick={canClose ? onClose : undefined}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div className="label">Sessão</div>
          <h2 className={styles.title}>Selecionar utilizador ativo</h2>
          <p className={styles.desc}>
            Escolhe quem está a operar a aplicação neste momento. A sessão ativa aparece no topo e é usada
            nas ações rápidas do laboratório.
          </p>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.empty}>A carregar utilizadores...</div>
          ) : users.length === 0 ? (
            <div className={styles.empty}>Ainda não existem utilizadores registados para iniciar sessão.</div>
          ) : (
            <div className={styles.userList}>
              {users.map((user) => {
                const isActive = activeUser?.id === user.id
                return (
                  <button
                    key={user.id}
                    type="button"
                    className={styles.userButton}
                    onClick={() => onSelect(user)}
                    disabled={isActive}
                  >
                    <div className={styles.userMeta}>
                      <div className={styles.userName}>{user.nome}</div>
                      <div className={styles.userInfo}>
                        <span className={styles.pill}>{formatRole(user)}</span>
                        <span>{user.numero_colaborador}</span>
                        <span>{user.departamento}</span>
                      </div>
                    </div>
                    <div className={styles.choose}>{isActive ? 'Ativo' : 'Entrar'}</div>
                  </button>
                )
              })}
            </div>
          )}

          {canClose && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
