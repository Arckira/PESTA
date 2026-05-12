import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import LoginModal from './components/LoginModal.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Avarias from './pages/Avarias.jsx'
import Calibracoes from './pages/Calibracoes.jsx'
import Dashboard from './pages/Dashboard.jsx'
import DetalheEquipamento from './pages/DetalheEquipamento.jsx'
import Equipamentos from './pages/Equipamentos.jsx'
import Login from './pages/Login.jsx'
import Manutencoes from './pages/Manutencoes.jsx'
import Reservas from './pages/Reservas.jsx'
import Utilizadores from './pages/Utilizadores.jsx'
import Verificacoes from './pages/Verificacoes.jsx'

export default function App() {
  return (
    <>
      <LoginModal />

      <Routes>
        <Route
          path="/"
          element={(
            <ProtectedRoute allowedRoles={['admin']}>
              <Layout><Dashboard /></Layout>
            </ProtectedRoute>
          )}
        />

        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute allowedRoles={['admin']}>
              <Layout><Dashboard /></Layout>
            </ProtectedRoute>
          )}
        />

        {/* Equipamentos: público — técnicos e operadores acedem via QR sem sessão prévia.
            A ação ?action=checkin é gerida internamente por DetalheEquipamento,
            que desencadeia o modal de login se o operador ainda não estiver autenticado. */}
        <Route path="/equipamentos" element={<Layout><Equipamentos /></Layout>} />
        <Route path="/equipamentos/:id" element={<Layout><DetalheEquipamento /></Layout>} />

        <Route
          path="/equipamentos/:id/reserva"
          element={(
            <ProtectedRoute allowedRoles={['admin', 'user']}>
              <Reservas startOpenModal />
            </ProtectedRoute>
          )}
        />

        <Route path="/avarias" element={<Layout><Avarias /></Layout>} />
        <Route path="/manutencoes" element={<Layout><Manutencoes /></Layout>} />
        <Route path="/verificacoes" element={<Layout><Verificacoes /></Layout>} />
        <Route path="/calibracoes" element={<Layout><Calibracoes /></Layout>} />
        <Route path="/login" element={<Layout><Login /></Layout>} />

        <Route
          path="/reservas"
          element={(
            <ProtectedRoute allowedRoles={['admin', 'user']}>
              <Layout><Reservas /></Layout>
            </ProtectedRoute>
          )}
        />

        <Route
          path="/utilizadores"
          element={(
            <ProtectedRoute allowedRoles={['admin']}>
              <Layout><Utilizadores /></Layout>
            </ProtectedRoute>
          )}
        />
      </Routes>
    </>
  )
}
