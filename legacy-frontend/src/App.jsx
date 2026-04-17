import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Equipamentos from './pages/Equipamentos.jsx'
import DetalheEquipamento from './pages/DetalheEquipamento.jsx'
import Avarias from './pages/Avarias.jsx'
import Manutencoes from './pages/Manutencoes.jsx'
import Calibracoes from './pages/Calibracoes.jsx'
import Reservas from './pages/Reservas.jsx'
import Utilizadores from './pages/Utilizadores.jsx'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"                  element={<Dashboard />} />
        <Route path="/equipamentos"      element={<Equipamentos />} />
        <Route path="/equipamentos/:id"  element={<DetalheEquipamento />} />
        <Route path="/avarias"           element={<Avarias />} />
        <Route path="/manutencoes"       element={<Manutencoes />} />
        <Route path="/calibracoes"       element={<Calibracoes />} />
        <Route path="/reservas"          element={<Reservas />} />
        <Route path="/utilizadores"      element={<Utilizadores />} />
      </Routes>
    </Layout>
  )
}