# Rotina TI

Sistema web local para organização da rotina de uma equipe de Tecnologia da Informação.

O projeto centraliza pendências individuais, equipamentos enviados para manutenção, documentos PDF, históricos e monitoramento de dispositivos da rede em um único painel compartilhado.

## Visão geral

O **Rotina TI** foi desenvolvido para funcionar em um computador servidor dentro da rede local. Os usuários acessam o painel pelo navegador, enquanto os dados permanecem armazenados localmente em SQLite.

### Principais recursos

- Autenticação com perfis de administrador e técnico
- Pendências individuais por usuário
- Prioridades, datas, horários e repetição semanal
- Histórico de tarefas concluídas
- Controle compartilhado de equipamentos em manutenção
- Histórico de manutenções finalizadas
- Upload e visualização de múltiplos PDFs por equipamento
- Registro de quem criou, editou ou concluiu cada ação
- Monitoramento manual de IPs
- Status online, offline e tempo de resposta
- Dashboard com indicadores operacionais
- Tela de descanso com relógio e animações
- Layout responsivo para desktop, tablet e celular
- Inicialização simplificada por arquivo `.bat`

## Tecnologias

- Node.js
- Express
- SQLite
- HTML5
- CSS3
- JavaScript
- Multer
- Express Session

## Requisitos

- Windows 10, Windows 11 ou Windows Server compatível
- Node.js LTS 20.17.0 ou superior
- npm
- Navegador moderno
- Acesso à rede local para os demais usuários

Verifique a instalação:

```powershell
node --version
npm.cmd --version
```

## Instalação

Clone o repositório:

```bash
git clone https://github.com/SEU-USUARIO/rotina-ti.git
cd rotina-ti
```

Instale as dependências:

```powershell
npm.cmd install
```

Inicie pelo arquivo:

```text
abrir-rotina-ti.bat
```

Também é possível iniciar manualmente:

```powershell
npm.cmd start
```

O sistema utiliza, por padrão:

```text
http://localhost:3000
```

Para acesso por outros computadores, utilize o hostname ou o endereço IPv4 do servidor:

```text
http://NOME-DO-SERVIDOR:3000
http://IP-DO-SERVIDOR:3000
```

## Estrutura do projeto

```text
rotina-ti/
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── uploads/
├── database.js
├── database.db
├── server.js
├── package.json
├── package-lock.json
├── abrir-rotina-ti.bat
└── README.md
```

> `database.db`, `uploads/`, arquivos de sessão e variáveis de ambiente não devem ser publicados no GitHub.

## Configuração da rede

O servidor deve escutar em:

```text
0.0.0.0
```

A porta padrão é:

```text
TCP 3000
```

Para liberar a porta no Firewall do Windows, abra o PowerShell ou Prompt de Comando como administrador:

```powershell
netsh advfirewall firewall add rule name="Rotina TI - TCP 3000" dir=in action=allow protocol=TCP localport=3000
```

Para remover a regra:

```powershell
netsh advfirewall firewall delete rule name="Rotina TI - TCP 3000"
```

Use apenas os perfis de rede autorizados pela política da organização.

## Contas e permissões

- A primeira conta criada recebe o perfil de administrador.
- Novos usuários devem ser criados por um administrador.
- As demais contas recebem o perfil técnico.
- As senhas são armazenadas como hash.
- A redefinição de senha é controlada pelo administrador.
- Exclusões definitivas exigem perfil administrativo.
- Os PDFs só podem ser acessados por usuários autenticados.

## Pendências

Cada usuário visualiza apenas suas próprias tarefas.

Campos disponíveis:

- Descrição
- Setor
- Data
- Hora
- Prioridade
- Status
- Repetição semanal

Ao concluir uma tarefa semanal, o sistema cria a próxima ocorrência para sete dias depois. As tarefas concluídas permanecem disponíveis no histórico individual.

## Equipamentos em manutenção

A lista de manutenções é compartilhada com toda a equipe.

Informações disponíveis:

- Tipo do equipamento
- Patrimônio
- Marca e modelo
- Número de série
- Setor ou usuário responsável
- Destino
- Data de envio
- Status
- Defeito e observações
- Usuário que cadastrou, editou ou registrou o retorno
- PDFs relacionados

Quando um equipamento retorna, o registro é movido para o histórico de manutenções. Ele pode ser reaberto posteriormente sem perder seus documentos.

## Monitor de IPs

Permite cadastrar manualmente dispositivos da rede e acompanhar:

- Nome do equipamento
- Categoria
- Endereço IP
- Setor ou local
- Observações
- Status online ou offline
- Tempo de resposta
- Data da última verificação

Categorias disponíveis:

- Relógio
- Switch
- Computador
- Impressora
- Access Point
- Câmera
- Servidor
- Outro

A verificação é executada pelo computador servidor. Alguns dispositivos podem estar ligados e ainda assim não responder ao protocolo de ping.

## Tela de descanso

A tela de descanso exibe:

- Hora atual
- Data completa
- Dia da semana
- Usuário conectado
- Identidade visual do sistema

Ela pode ser aberta manualmente ou ativada automaticamente após um período de inatividade. O retorno ao painel ocorre pelo botão de voltar, pela tecla `ESC` ou por atividade do usuário, conforme a configuração do sistema.

## Backup

Antes de atualizar ou mover o sistema, interrompa o servidor e preserve:

```text
database.db
database.db-wal
database.db-shm
uploads/
session-secret.txt
```

Os arquivos `database.db-wal` e `database.db-shm` podem não existir em todos os momentos.

Nunca misture o banco de uma data com arquivos WAL, SHM ou PDFs de outro backup.

## Atualização sem perda de dados

1. Pare o servidor.
2. Faça um backup completo.
3. Preserve o banco, os arquivos WAL/SHM, a pasta `uploads` e o segredo de sessão.
4. Substitua somente os arquivos do programa.
5. Execute novamente:

```powershell
npm.cmd install
```

6. Inicie pelo `abrir-rotina-ti.bat`.
7. Valide login, tarefas, manutenções, PDFs e monitoramento de IPs.

## Segurança

Nunca envie ao GitHub:

- `database.db`
- `database.db-wal`
- `database.db-shm`
- `uploads/`
- `session-secret.txt`
- `.env`
- senhas, tokens ou chaves
- listas de IPs internos
- PDFs ou documentos da organização

Exemplo de `.gitignore`:

```gitignore
node_modules/

database.db
database.db-*
uploads/
session-secret.txt

.env
.env.*
!.env.example

importar-ips.js
importar-ips.bat

*.log
*.zip
backup/
Thumbs.db
Desktop.ini
```

Para projetos com dados internos, mantenha o repositório como **privado**.

## Validação

Verifique a sintaxe:

```powershell
npm.cmd run check
```

Execute os testes:

```powershell
npm.cmd test
```

Com o servidor em execução, teste o endpoint de saúde:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

O resultado esperado deve conter:

```json
{
  "ok": true
}
```

## Solução rápida de problemas

### O servidor abre, mas outros computadores não acessam

- Confirme que o servidor está ligado.
- Teste `http://localhost:3000` no próprio servidor.
- Verifique a regra da porta TCP 3000.
- Confirme o perfil de rede e a resolução do hostname.
- Teste o acesso pelo endereço IPv4.

### A porta 3000 está ocupada

No Prompt de Comando:

```powershell
netstat -ano | findstr :3000
```

No PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

### O PDF está registrado, mas não abre

- Confirme que a pasta `uploads/` correta foi restaurada.
- Verifique as permissões da pasta.
- Confirme se o caminho configurado para uploads não foi alterado.

## Uso responsável

Este projeto foi criado para uso operacional em rede local. Qualquer publicação externa, túnel, VPN ou acesso pela internet deve ser previamente aprovado pela equipe responsável por infraestrutura e segurança.

## Autor

**Kaynan Araujo**

Desenvolvedor Full Stack e Analista de Suporte.
