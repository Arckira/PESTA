# Industrial Testing Lab — Asset & Operations Management Platform

Sistema integrado de gestão de laboratório industrial, focado na **digitalização e otimização de operações de ensaio**: inventário de equipamentos, reservas, manutenção, avarias, calibrações e indicadores de desempenho (OEE) em tempo real.

Projeto académico/pessoal, desenvolvido de raiz e avaliado com 19 valores.

## Overview

A plataforma cobre o ciclo de vida operacional de um laboratório de ensaios industriais, desde o registo de um equipamento até à sua utilização diária, manutenção e análise de desempenho.

## Features

- **Gestão de Ativos**: inventário técnico de equipamentos (câmaras climáticas, câmaras de choque térmico, fornos, salinas, etc.), com estado operacional em tempo real.
- **Reservas e Agendamento**: calendário de utilização (FullCalendar) para evitar conflitos entre operadores.
- **Avarias e Manutenção**: registo, acompanhamento e resolução de avarias; histórico de manutenções preventivas/corretivas com custos e fornecedores.
- **Calibrações e Verificações**: controlo de validade de calibrações e alertas de vencimento.
- **OEE Industrial**: cálculo de Disponibilidade, Performance e Qualidade por equipamento e por família de ativos.
- **Rastreabilidade**: histórico de sessões de uso, eventos e emissão de relatórios em PDF.
- **Check-in por QR Code**: identificação rápida de equipamentos via QR Code, com um fluxo mobile-first dedicado.
- **Autenticação e Perfis**: controlo de acesso por utilizador/perfil (ex. administrador vs. operador).

## Architecture

```
React / Vite
      │
      │ REST API (JSON)
      ▼
FastAPI
      │
      ▼
SQLModel / SQLAlchemy
      │
      ▼
SQLite (WAL) ── modo de desenvolvimento e implementação atual
      │
      └── camada de acesso a dados preparada para dialeto MSSQL
          (deteção de dialeto e migração incremental de esquema
           já implementadas; não usado em produção neste projeto)
```

## Technology Stack

- **Backend**: Python 3.12, FastAPI, SQLModel/SQLAlchemy, Alembic (migrações), APScheduler (tarefas periódicas), Playwright (geração de PDFs), Pydantic.
- **Frontend**: React, Vite, React Router, FullCalendar, Recharts, i18n (PT/EN), Lucide icons.
- **Base de dados**: SQLite em modo WAL (implementação e demonstração atuais). O código de acesso a dados já distingue o dialeto da ligação e aplica migrações condicionais de esquema para SQLite e MSSQL — a base está preparada para migrar para SQL Server, mas essa migração **não foi executada nem validada** neste projeto.
- **Testes**: pytest (backend), vitest (frontend).

## Project Structure

```
.
├── Backend/
│   ├── app/
│   │   ├── core/        # configuração, segurança, dependências
│   │   ├── db/          # engine, migrações Alembic
│   │   ├── models/       # modelos SQLModel
│   │   ├── routers/      # endpoints FastAPI
│   │   ├── schemas/      # esquemas Pydantic de request/response
│   │   └── services/     # regras de negócio (OEE, auth, PDF, agendamento)
│   ├── scripts/          # utilitários de manutenção de dados de demonstração
│   └── tests/            # suite pytest
└── Frontend/
    └── src/
        ├── components/    # componentes reutilizáveis (layout, modais, QR code)
        ├── contexts/      # autenticação, idioma
        ├── hooks/         # hooks de dados por domínio
        ├── i18n/          # traduções PT/EN
        ├── pages/         # páginas da aplicação
        └── utils/         # cálculos e configuração de rede
```

## Installation

### Configuration

Cada componente tem o seu próprio `.env.example` — copiar para `.env` e ajustar conforme o ambiente:

```
/.env.example            # variáveis partilhadas de referência
/Backend/.env.example    # DATABASE_URL, CORS_ORIGINS, pool de ligações
/Frontend/.env.example   # tempo de inatividade da sessão
```

Nenhum dos ficheiros `.env.example` contém credenciais reais — apenas placeholders.

### Running the Backend

```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # ajustar conforme necessário
python run.py                 # ou: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Running the Frontend

```bash
cd Frontend
npm install
copy .env.example .env        # ajustar conforme necessário
npm run dev
```

### Testing

```bash
cd Backend
pytest
```

```bash
cd Frontend
npx vitest run
```

### Build

```bash
cd Frontend
npm run build
```

## Engineering Practices

- **Modularidade**: backend organizado por camadas (`models`, `schemas`, `routers`, `services`, `core`), sem lógica de negócio nos endpoints.
- **Transaction safety**: operações críticas em SQL usam sessões transacionais com `rollback` explícito em caso de erro, preservando a integridade referencial.
- **Poka-Yoke / prevenção de erro**: validação de esquemas com Pydantic, máquinas de estado para equipamentos/sessões e verificações que impedem transições inválidas (ex. reservas sobrepostas, equipamento em avaria a ser reservado).
- **Resiliência**: tratamento explícito de exceções nos pontos de falha mais prováveis (BD, geração de PDF, agendamento).
- **Logging estruturado**: uso do módulo `logging` do Python com níveis apropriados, em vez de `print()`.
- **Testes automatizados**: suite `pytest` cobre regras de negócio críticas (OEE, validação de reservas, máquina de estados, segurança).
- **Internacionalização**: interface disponível em Português e Inglês.

Não são reivindicadas certificações formais (ISO/IATF); as práticas acima seguem princípios de engenharia habitualmente associados a esses referenciais, aplicados ao nível do código.

## Security

- Autenticação por PIN com hash PBKDF2-SHA256 e salt único por utilizador (nunca armazenado em texto plano) e sessões com expiração.
- `.env`, bases de dados locais, executáveis, backups e logs estão excluídos do controlo de versões (`.gitignore`).
- Não existem credenciais, chaves de API nem connection strings reais neste repositório — apenas placeholders em `.env.example`.
- Este repositório foi anonimizado a partir do projeto original: nomes de empresa, logótipos e identificadores específicos foram substituídos por termos genéricos. A funcionalidade e as regras de negócio não foram alteradas.

## License / Usage

Projeto pessoal/académico, publicado como amostra de portfólio. Sem licença open-source formal atribuída — consultar o autor antes de reutilização comercial.

## Notas

Dados de demonstração podem ser gerados com `Backend/seed_demo_poster.py` (nunca correr sobre a base de dados de produção — ver instruções no próprio ficheiro).
