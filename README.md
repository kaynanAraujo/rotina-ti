# Rotina TI

Sistema local para controle de rotina de TI, criado para organizar pendências do dia, acompanhar equipamentos enviados para manutenção e manter registros importantes da rotina operacional.

## Funcionalidades

* Tela de login
* Criação de conta no primeiro acesso
* Cadastro de pendências de TI
* Controle de prioridade e status das tarefas
* Registro de equipamentos enviados para manutenção
* Controle de patrimônio, serial, setor, usuário e observações
* Exportação de backup
* Importação de backup
* Interface moderna e responsiva
* Sistema local para uso no computador

## Como acessar

Ao abrir o sistema pela primeira vez, o usuário deverá criar sua própria conta.

Depois de criar a conta, basta usar o usuário e senha cadastrados para acessar o painel.

---

## Como baixar e executar o projeto

### 1. Instale o Node.js

Antes de abrir o sistema, é necessário ter o Node.js instalado no computador.

Baixe pelo site oficial:

https://nodejs.org/

Instale a versão recomendada.

Depois de instalar, reinicie o computador se necessário.

Para conferir se instalou corretamente, abra o terminal do Windows e digite:

```bash
node -v
```

Depois digite:

```bash
npm -v
```

Se aparecer uma versão, está tudo certo.

---

### 2. Baixe o projeto

No GitHub, clique no botão verde:

```txt
Code
```

Depois clique em:

```txt
Download ZIP
```

Extraia o arquivo ZIP em uma pasta do computador.

---

## Como abrir pelo VS Code

### 1. Abra o projeto no VS Code

Abra o Visual Studio Code.

Clique em:

```txt
File > Open Folder
```

Ou em português:

```txt
Arquivo > Abrir Pasta
```

Selecione a pasta do projeto extraída.

A pasta correta é a que contém arquivos como:

```txt
package.json
main.js
abrir-rotina-ti.bat
public
```

---

### 2. Abra o terminal no VS Code

Dentro do VS Code, clique em:

```txt
Terminal > New Terminal
```

Ou em português:

```txt
Terminal > Novo Terminal
```

Também pode usar o atalho:

```txt
Ctrl + '
```

O terminal precisa abrir já dentro da pasta do projeto.

---

### 3. Instale as dependências

No terminal do VS Code, digite:

```bash
npm install
```

Esse comando vai criar a pasta `node_modules` e instalar tudo que o sistema precisa para funcionar.

A pasta `node_modules` não precisa ser enviada para o GitHub.

---

### 4. Inicie o sistema

Depois que terminar a instalação, rode:

```bash
npm start
```

O sistema será iniciado localmente no computador.

Se preferir, também pode abrir pelo arquivo:

```txt
abrir-rotina-ti.bat
```

---

## Como abrir pelo arquivo BAT

Depois de instalar as dependências com:

```bash
npm install
```

basta clicar duas vezes no arquivo:

```txt
abrir-rotina-ti.bat
```

Esse arquivo serve para facilitar a abertura do sistema no Windows.

Ele abre o projeto sem precisar digitar o comando manualmente toda vez.

---

## Estrutura dos arquivos

```txt
public/
  index.html
  style.css
  script.js

main.js
package.json
package-lock.json
abrir-rotina-ti.bat
README.md
```

---

## Observação importante

Não envie a pasta `node_modules` para o GitHub.

Ela é muito pesada e é criada automaticamente quando o comando abaixo é executado:

```bash
npm install
```

No GitHub, envie apenas os arquivos do projeto, como:

```txt
public
main.js
package.json
package-lock.json
abrir-rotina-ti.bat
README.md
```

Também não é recomendado enviar arquivos temporários, builds antigos ou instaladores desnecessários, como:

```txt
node_modules
dist
build
.env
```

---

## Como atualizar o projeto no GitHub

Quando fizer alterações no projeto, envie novamente os arquivos principais para o GitHub.

Arquivos importantes para manter atualizados:

```txt
public/index.html
public/style.css
public/script.js
main.js
package.json
package-lock.json
abrir-rotina-ti.bat
README.md
```

Não envie a pasta `node_modules`.

---

## Possíveis problemas

### O comando npm não funciona

Verifique se o Node.js foi instalado corretamente.

No terminal, teste:

```bash
node -v
npm -v
```

Se não aparecer uma versão, instale novamente o Node.js.

---

### O sistema não abre

Confira se você executou primeiro:

```bash
npm install
```

Depois tente abrir novamente com:

```bash
npm start
```

Ou clique duas vezes no arquivo:

```txt
abrir-rotina-ti.bat
```

---

### A pasta node_modules sumiu

Isso é normal.

Ela não precisa ficar no GitHub.

Para recriar, basta rodar:

```bash
npm install
```

---

## Sobre o projeto

Este projeto foi criado como uma ferramenta local para auxiliar na organização de tarefas e controles internos de TI.

Ele pode ser usado como projeto de estudo, portfólio ou base para sistemas internos simples.

O objetivo é facilitar a rotina de profissionais de TI, permitindo registrar pendências, acompanhar prioridades e controlar equipamentos enviados para manutenção.
