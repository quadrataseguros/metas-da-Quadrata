# Quadrata - Metas

Painel de metas da equipe da Quadrata Seguros. Um único site com três telas que mostram os mesmos dados ao vivo:

- **Vendedoras** (`/#vendedoras`): cada uma entra com o próprio nome e PIN. A venda sai sempre no nome de quem entrou.
- **Master** (`/#master`): entra com a senha master. Lança as vendas do ano anterior por seguradora e produto (aceita colar do Excel), ajusta pontos, níveis e premiação e apaga vendas lançadas por engano.
- **Monitor** (`/tv?k=CHAVE`): link fixo para a TV, só leitura, atualiza sozinho e mostra um aviso em tela cheia a cada venda nova.

Financiamento e consórcio contam só pela Porto. A meta por seguradora é o mesmo mês do ano anterior mais o percentual de crescimento definido na tela master (10% por padrão).

## Publicar no Render

1. No Render, clique em **New > Blueprint** e escolha este repositório. O arquivo `render.yaml` cria o site e o banco Postgres.
2. Preencha as variáveis que o Render pedir:
   - `MASTER_PASSWORD`: a senha master (só do Fabricio).
   - `PIN_DYOVANNA`, `PIN_ANACLARA` e `PIN_ALANA`: o PIN de cada vendedora.
3. Depois do deploy, abra **Environment** no serviço `arena-quadrata` e copie o valor de `MONITOR_KEY`. O link da TV é `https://SEU-ENDERECO.onrender.com/tv?k=MONITOR_KEY`.

Para trocar uma senha ou PIN, altere a variável no Render; o site reinicia sozinho. Quem já estava logado continua logado até sair. Para derrubar todos os acessos, gere um novo `SESSION_SECRET`.

## Rodar no computador

```
npm install
MASTER_PASSWORD=teste PIN_DYOVANNA=1 PIN_ANACLARA=2 PIN_ALANA=3 MONITOR_KEY=tv npm start
```

Sem `DATABASE_URL`, os dados ficam no arquivo `dados-local.json`.
