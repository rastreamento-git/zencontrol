# Início do ZenControl 6

Siga o [README](README.md) para instalação e [IMPLANTACAO.md](docs/IMPLANTACAO.md) para os ambientes de produção.

1. Instale Node.js 24 e Docker Desktop (ou tenha um PostgreSQL disponível).
2. Execute `npm ci --include=dev` e `npm run setup`.
3. Execute `docker compose up -d db`, `npm run migrate` e `npm run build`.
4. Ative `ZEN_RUN_WORKER=true` no `.env` e execute `npm start` (ou `INICIAR_WINDOWS.bat`).
5. Abra o endereço definido em `ZEN_PUBLIC_URL`; usuário/senha estão no `.env` local.
6. Conecte o Estoque Pro e vincule os cadastros dos técnicos antes de aprovar instalações.

O primeiro acesso é da administração. Crie acessos de técnico em **Equipe e acessos**; o login desse perfil abre o portal automaticamente.

Esta versão inicia uma base nova. Não é necessário purgar ou importar o SQLite anterior. Preserve os arquivos antigos para eventual consulta fora deste repositório.
