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

carregarPagamentos();
