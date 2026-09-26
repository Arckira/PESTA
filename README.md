# PESTA — Industrial Testing Lab Asset & Operations Management Platform

**PESTA** é uma plataforma full-stack (React + FastAPI) de gestão de ativos para laboratórios de ensaios industriais: inventário de equipamentos, reservas, manutenção, avarias, calibrações e OEE em tempo real.

Projeto académico/pessoal, desenvolvido de raiz (schema de dados, API, UI, testes) e avaliado com 19 valores.

## Problem / Solution

**Problema**: um laboratório de ensaios industriais tem dezenas de equipamentos partilhados (câmaras climáticas, câmaras de choque térmico, fornos, salinas), operados por várias equipas. Sem um sistema central, a informação sobre quem está a usar o quê, o estado de cada equipamento, o histórico de avarias/manutenções e o desempenho real (OEE) fica dispersa em folhas de cálculo e conhecimento informal — o que gera conflitos de reserva, equipamento avariado a ser usado por engano, e nenhuma visibilidade sobre disponibilidade real.

**Solução**: o PESTA centraliza todo esse ciclo de vida numa única aplicação web — um equipamento tem sempre um estado único e consistente (Disponível/Ocupado/Avariado/Em Manutenção/Em Calibração), reservas e check-in por QR Code impedem conflitos e usos inválidos ao nível da API, e o dashboard calcula OEE, MTBF e MTTR a partir dos dados reais de utilização.

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

## Technical Decisions

Decisões relevantes, com o porquê (não apenas o quê):

- **SQLite em WAL, com camada de acesso já dialect-aware para MSSQL**: para um projeto de um único laboratório, SQLite elimina a necessidade de um servidor de BD dedicado; WAL mode permite leituras concorrentes durante escritas (relevante com múltiplos operadores/reservas em simultâneo). O código de acesso a dados (`Backend/app/db/database.py`) já deteta o dialeto da ligação e aplica migrações condicionais compatíveis com SQL Server, para que a mudança de infraestrutura, se necessária, não implique reescrever a camada de dados — mas essa migração nunca foi executada nem validada.
- **Máquina de estados ao nível do equipamento, não apenas validação de formulário**: o estado (Disponível/Ocupado/Avariado/Em Manutenção/Em Calibração) é a fonte de verdade única; transições inválidas (ex. reservar um equipamento avariado, check-in duplo do mesmo utilizador) são rejeitadas na API com códigos HTTP específicos (400/409), não apenas bloqueadas na UI — princípio Poka-Yoke aplicado ao backend.
- **Autenticação por PIN + hash PBKDF2-SHA256 com salt, tokens de sessão opacos em vez de JWT**: adequado ao contexto (utilizadores internos, terminal físico/QR Code em vez de login remoto complexo); tokens opacos permitem invalidação imediata de sessão do lado do servidor, o que um JWT auto-contido não permite sem infraestrutura adicional (blocklist).
- **Geração de PDF server-side com Playwright (HTML→PDF)** em vez de uma biblioteca de geração de PDF em Python: permite reutilizar CSS normal para layout dos relatórios, mais simples de manter do que APIs de desenho de PDF de baixo nível.

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

- Autenticação por PIN com hash PBKDF2-SHA256 e salt único por utilizador (nunca armazenado em texto plano); tokens de sessão são valores aleatórios opacos (`secrets.token_urlsafe`) com expiração — não há JWT nem chave secreta estática no sistema.
- Novos utilizadores são criados com um PIN inicial fixo (`0000`, ver `Backend/app/services/auth_service.py`), mas com `forcar_troca_pin=True`: o acesso é bloqueado (`Backend/app/core/deps.py`) até o PIN ser alterado no primeiro login. Padrão conhecido e intencional — não é uma credencial esquecida.
- `.env`, bases de dados locais, executáveis, backups e logs estão excluídos do controlo de versões (`.gitignore`).
- Não existem credenciais, chaves de API nem connection strings reais neste repositório — apenas placeholders em `.env.example`.
- Este repositório foi anonimizado a partir do projeto original: nomes de empresa, logótipos e identificadores específicos foram substituídos por termos genéricos. A funcionalidade e as regras de negócio não foram alteradas.
- **Known dependency audit findings — review recommended before production deployment.** `npm audit` no frontend reporta vulnerabilidades nas dependências de build (`vite`/`esbuild`/`postcss`/`nanoid`, todas em `devDependencies`, nunca em `dependencies`); não afetam o bundle estático gerado por `npm run build`, mas devem ser revistas antes de qualquer deployment real.

## License / Usage

Projeto pessoal/académico, publicado como amostra de portfólio. Sem licença open-source formal atribuída — consultar o autor antes de reutilização comercial.

## Notas

- Dados de demonstração podem ser gerados com `Backend/seed_demo_poster.py` (nunca correr sobre a base de dados de produção — ver instruções no próprio ficheiro).
- O screenshot original do dashboard foi removido durante a anonimização (continha o logótipo da empresa original). Ainda não foi adicionado um novo screenshot/GIF de demonstração a este README — a fazer antes de divulgar o repositório amplamente como peça de portfólio.
