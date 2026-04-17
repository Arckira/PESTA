import React, { useState } from 'react';

/**
 * Componente de Seleção de Equipamento para a Modal
 * Localização: src/components/EquipamentoSelector.jsx
 */
const EquipamentoSelector = ({ onSelect }) => {
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');

  // Lista temporária de equipamentos (Ex: Máquinas da Yazaki)
  const dummyEquipamentos = [
    { id: 1, tag: "PRE-001", nome: "Prensa Hidráulica A" },
    { id: 2, tag: "COR-042", nome: "Máquina de Corte Laser" },
    { id: 3, tag: "MON-015", nome: "Bancada de Montagem" },
    { id: 4, tag: "TES-007", nome: "Testador de Continuidade" }
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    
    try {
      if (!selectedId) {
        throw new Error("Selecione um equipamento antes de continuar.");
      }
      
      // Procuramos o objeto completo para enviar para o componente pai
      const equipamento = dummyEquipamentos.find(e => e.id === parseInt(selectedId));
      onSelect(equipamento);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="equip-select" className="text-sm font-bold text-gray-600 uppercase tracking-wide">
          Identificação do Equipamento
        </label>

        <select
          id="equip-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={`p-2.5 bg-white border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500
            ${error ? 'border-red-500' : 'border-gray-300'}`}
        >
          <option value="">-- Selecione o Equipamento --</option>
          {dummyEquipamentos.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.tag} - {eq.nome}
            </option>
          ))}
        </select>

        {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

        <button
          type="submit"
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-all font-medium uppercase text-sm"
        >
          Confirmar Seleção
        </button>
      </form>
    </div>
  );
};

export default EquipamentoSelector;