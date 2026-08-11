module.exports = [
  {
    id: "template1",
    label: "Template 1",
    description: "Modelo completo com todos os campos.",
    embed: {
      author: {
        name: "Nome do autor",
        icon_url: "https://cdn.hipe.studio/assets/wave/wave-logo.gif",
        url: "https://discord.gg/wave"
      },
      title: "Titulo do embed",
      url: "https://discord.gg/wave",
      description: "Descricao principal do embed. Use este espaco para escrever a mensagem que sera enviada no canal.",
      thumbnail: {
        url: "https://cdn.hipe.studio/assets/wave/wave-logo.gif"
      },
      image: {
        url: "https://cdn.hipe.studio/assets/wave/wave-banner.png"
      },
      fields: [
        {
          name: "Campo inline 1",
          value: "Valor do primeiro campo.",
          inline: true
        },
        {
          name: "Campo inline 2",
          value: "Valor do segundo campo.",
          inline: true
        },
        {
          name: "Campo normal",
          value: "Valor de um campo ocupando a linha inteira.",
          inline: false
        }
      ],
      footer: {
        text: "Texto do rodape",
        icon_url: "https://cdn.hipe.studio/assets/wave/wave-logo.gif"
      },
      timestamp: "agora"
    }
  }
];
