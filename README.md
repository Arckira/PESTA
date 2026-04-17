# PESTA

Sistema Integrado de Gestão de Laboratório para o Testing Centre da Yazaki, focado na **Digitalização e Otimização Industrial**.

## 🎯 Objetivo do MVP

Implementar uma plataforma única, robusta e escalável para gerir o ciclo de vida completo dos ativos de laboratório:

- **Gestão de Inventário**: registo técnico de equipamentos (microcontroladores, sensores, drivers, etc.).
- **Controlo de Operações**: reservas e agendamento para evitar conflitos de utilização.
- **Manutenção e Calibração**: monitorização de estados (*Operacional*, *Avaria*, *Manutenção*) e alertas de calibração.
- **Análise de Dados**: dashboard com métricas críticas em tempo real (disponibilidade e histórico de falhas).

## 🧱 Arquitetura Tecnológica

- **Backend**: Python com FastAPI, com foco em desempenho e modularidade.
- **Frontend**: React com interface responsiva e CSS moderno (Tailwind/Bootstrap).
- **Base de Dados**: MSSQL (SQL Server 2022 Express), alinhado com a infraestrutura Yazaki.

## 🧪 Metodologia de Desenvolvimento

- **Código Limpo**: PEP8 no Python e organização modular.
- **Robustez**: validação de inputs e tratamento de exceções para reduzir falhas em contexto crítico.
- **Documentação Técnica**: docstrings (Google/NumPy) para manutenção, avaliação técnica e sustentabilidade.
- **Execução Passo-a-Passo**: identificação de variáveis, aplicação teórica e cálculos intermédios em cada resolução.

## 🚀 Próximos Entregáveis

1. Definição do modelo de dados (inventário, reservas, manutenção e eventos de falha).
2. Implementação dos serviços de backend em FastAPI.
3. Criação da interface React para operação diária do laboratório.
4. Disponibilização de dashboard operacional com indicadores-chave.
