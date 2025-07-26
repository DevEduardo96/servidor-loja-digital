// Produtos.js
let produtos = [
  {
    id: "2511ce44-fa75-4ce2-8ce8-d0590e7cb394",
    nome: "Curso Completo de React.js",
    preco: 0.1,
    linkDownload:
      "https://www.mediafire.com/file/exhl83mwtoz65kp/Invenc%25C3%25ADvel_%2528Invincible%2529_-_%25230001.cbr/file",
  },
  {
    id: "3d1ef734-5b8d-48be-b770-d1db7a6d302a",
    nome: "E-book: Design System Completo",
    preco: 79.9,
    linkDownload: "https://seusite.com/downloads/design-system.pdf",
  },
  {
    id: "6172f4cb-5df8-4d23-ac90-2b3bf4329c4d",
    nome: "Template Premium Dashboard",
    preco: 89.9,
    linkDownload: "https://seusite.com/downloads/dashboard-template.zip",
  },
  {
    id: "3b7277fc-5784-4eef-b34e-80c50ad07c37",
    nome: "Masterclass: Marketing Digital",
    preco: 199.9,
    linkDownload: "https://seusite.com/downloads/masterclass-marketing.zip",
  },
  {
    id: "fed1a412-9ce4-4f6a-9d60-31edb4e2da3e",
    nome: "Pack de Ícones Premium",
    preco: 39.9,
    linkDownload: "https://seusite.com/downloads/icones-premium.zip",
  },
  {
    id: "b4215049-5ec3-4a2e-a4cc-58ff9dbc0e4c",
    nome: "Curso Node.js Avançado",
    preco: 179.9,
    linkDownload: "https://seusite.com/downloads/node-curso.zip",
  },
];

function getProdutoPorId(id) {
  return produtos.find((produto) => produto.id === id);
}

function adicionarProduto(produto) {
  produtos.push(produto);
}

function removerProduto(id) {
  produtos = produtos.filter((produto) => produto.id !== id);
}

function listarProdutos() {
  return produtos;
}

module.exports = {
  produtos,
  getProdutoPorId,
  adicionarProduto,
  removerProduto,
  listarProdutos,
};
