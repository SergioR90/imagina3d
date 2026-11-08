# Imagina3D

Dashboard de gestão e produção 3D: encomendas (kanban), bobinas, impressoras, KPIs e calculadora de orçamentos com importação de modelos do MakerWorld.

## Estrutura

| Caminho | Função |
|---|---|
| `index.html` | App (UI, estado local e sincronização Firebase) |
| `js/pricing.js` | Motor de preços (lógica pura) |
| `js/makerworld.js` | Parsing e normalização de dados do MakerWorld (lógica pura) |
| `js/makerworld-ui.js` | Painel de importação MakerWorld |
| `js/calculator.js` | UI da calculadora |
| `cloudflare-worker/` | Proxy opcional para contornar o CORS do MakerWorld (ver o README da pasta) |
| `firestore.rules` | Regras de segurança do Firestore |
| `tests/` | Testes (Node, sem dependências) |

## Testes

```bash
node --test tests/*.test.js
```

O workflow de CI corre os testes antes de publicar no GitHub Pages; só `index.html` e `js/` são publicados.

## Segurança

As regras em `firestore.rules` estão atualmente abertas (qualquer pessoa com a chave pública pode ler e escrever). Ver a nota no ficheiro antes de as restringir.
