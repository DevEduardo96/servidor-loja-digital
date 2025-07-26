async function carregarPagamentos() {
  try {
    const res = await fetch(
      "https://servidor-loja-digital.onrender.com/admin/pagamentos",
      {
        headers: {
          Authorization: "Bearer senha-secreta",
        },
      }
    );
    const pagamentos = await res.json();

    const tabela = `
        <table class="min-w-full bg-white shadow rounded">
          <thead>
            <tr class="bg-gray-200 text-left">
              <th class="p-2">Cliente</th>
              <th class="p-2">Email</th>
              <th class="p-2">Status</th>
              <th class="p-2">Total</th>
              <th class="p-2">Data</th>
            </tr>
          </thead>
          <tbody>
            ${pagamentos
              .map(
                (p) => `
              <tr class="border-t">
                <td class="p-2">${p.customerName}</td>
                <td class="p-2">${p.customerEmail}</td>
                <td class="p-2">${p.status}</td>
                <td class="p-2">R$ ${p.total.toFixed(2)}</td>
                <td class="p-2">${new Date(p.createdAt).toLocaleString()}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `;

    document.getElementById("tabela-pagamentos").innerHTML = tabela;
  } catch (error) {
    console.error("Erro ao carregar pagamentos:", error);
    document.getElementById(
      "tabela-pagamentos"
    ).innerHTML = `<p class='text-red-600'>Erro ao buscar dados.</p>`;
  }
}

// Adiciona novo produto
document
  .getElementById("form-produto")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("nome").value;
    const preco = parseFloat(document.getElementById("preco").value);
    const linkDownload = document.getElementById("linkDownload").value;

    const res = await fetch(
      "https://servidor-loja-digital.onrender.com/admin/produtos",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer senha-secreta",
        },
        body: JSON.stringify({ nome, preco, linkDownload }),
      }
    );

    const data = await res.json();
    alert("Produto adicionado!");
    carregarProdutos();
  });

// Carrega lista de produtos
async function carregarProdutos() {
  const res = await fetch(
    "https://servidor-loja-digital.onrender.com/admin/produtos",
    {
      headers: {
        Authorization: "Bearer senha-secreta",
      },
    }
  );
  const produtos = await res.json();

  const html = `
    <table class="min-w-full bg-white shadow rounded">
      <thead>
        <tr class="bg-gray-200 text-left">
          <th class="p-2">Nome</th>
          <th class="p-2">Preço</th>
          <th class="p-2">Link</th>
          <th class="p-2">Ação</th>
        </tr>
      </thead>
      <tbody>
        ${produtos
          .map(
            (p) => `
          <tr class="border-t">
            <td class="p-2">${p.nome}</td>
            <td class="p-2">R$ ${p.preco}</td>
            <td class="p-2 text-blue-600 underline"><a href="${p.linkDownload}" target="_blank">Download</a></td>
            <td class="p-2"><button onclick="removerProduto('${p.id}')" class="bg-red-600 text-white px-3 py-1 rounded">Remover</button></td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;

  document.getElementById("lista-produtos").innerHTML = html;
}

async function removerProduto(id) {
  if (!confirm("Tem certeza que deseja remover este produto?")) return;

  await fetch(
    `https://servidor-loja-digital.onrender.com/admin/produtos/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: "Bearer senha-secreta",
      },
    }
  );

  alert("Produto removido!");
  carregarProdutos();
}

// Carrega produtos ao iniciar
carregarProdutos();

carregarPagamentos();
