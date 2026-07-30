ROTINA TI SERVER v2.2
=====================

Sistema local para a rotina da equipe de TI, executado com Node.js, Express e
SQLite. O painel oferece autenticação, pendências particulares, histórico de
tarefas, equipamentos em manutenção, vários PDFs por equipamento, monitor de
IPs e uma tela de descanso premium. O servidor atende a rede local pela porta
TCP 3000 e escuta em 0.0.0.0.


1. REQUISITOS E INSTALAÇÃO
--------------------------

Requisitos:
- Windows 10/11 ou Windows Server compatível.
- Node.js LTS atual, versão 20.17.0 ou superior.
- Acesso à rede local para os computadores que usarão o painel.

Instalação do Node.js:
1. Acesse https://nodejs.org/ e baixe a versão identificada como LTS.
2. Execute o instalador mantendo o npm selecionado.
3. Conclua a instalação e abra um novo Prompt de Comando.
4. Confirme:

   node --version
   npm.cmd --version

O BAT informa um erro claro se package.json, Node.js, npm ou Windows PowerShell
não estiverem disponíveis. As dependências já presentes são preservadas. Se a
pasta node_modules não existir, o BAT executa npm.cmd install na primeira vez.


2. COMO INICIAR
---------------

1. Abra a pasta completa do Rotina TI.
2. Clique duas vezes em abrir-rotina-ti.bat.
3. Aguarde a confirmação de inicialização.
4. O BAT procura o Google Chrome nos locais comuns de instalação do Windows.
   Se não encontrar o Chrome, usa o navegador padrão.

O BAT sempre fixa PORT=3000 e mostra estes endereços:

http://localhost:3000
http://ANDDSKTI01:3000
http://ANDDSKTI01.corporate.ad:3000

Antes de iniciar, o BAT consulta http://localhost:3000/api/health:
- Se encontrar o Rotina TI ativo, apenas abre o navegador e não inicia outra
  instância.
- Se a porta 3000 estiver ocupada por outro programa, informa o conflito e não
  inicia o servidor.
- Se a porta estiver livre, inicia uma única instância e aguarda a aplicação
  responder por até 15 segundos.

Mantenha aberta a janela "Servidor Rotina TI". Para encerrar corretamente,
pressione Ctrl+C nessa janela e confirme, ou feche a janela quando ninguém
estiver usando o sistema.


3. ENDEREÇOS E ACESSO PELA REDE
-------------------------------

No próprio servidor:
- http://localhost:3000

Nos computadores do domínio/rede local:
- http://ANDDSKTI01:3000
- http://ANDDSKTI01.corporate.ad:3000

Se a resolução de nome não estiver disponível, descubra o IPv4 do servidor com:

ipconfig

Depois acesse http://IP-DO-SERVIDOR:3000. O computador ANDDSKTI01 deve
permanecer ligado, conectado à rede e com o Rotina TI em execução.


4. LIBERAR A PORTA 3000 NO FIREWALL DO WINDOWS
----------------------------------------------

Opção por comando:
1. Abra Prompt de Comando ou Windows PowerShell como Administrador.
2. Execute:

   netsh advfirewall firewall add rule name="Rotina TI - TCP 3000" dir=in action=allow protocol=TCP localport=3000

Para remover somente essa regra no futuro:

   netsh advfirewall firewall delete rule name="Rotina TI - TCP 3000"

Opção pela interface:
1. Abra "Firewall do Windows Defender com Segurança Avançada".
2. Selecione "Regras de Entrada" e depois "Nova Regra".
3. Escolha "Porta".
4. Selecione TCP e informe a porta local específica 3000.
5. Escolha "Permitir a conexão".
6. Marque os perfis autorizados pela política da empresa, normalmente Domínio
   e Privado. Evite Público quando não for necessário.
7. Use o nome "Rotina TI - TCP 3000" e conclua.

Se o acesso externo continuar indisponível, confirme DNS, política do domínio,
antivírus/firewall corporativo e conectividade entre os computadores.


5. CONTAS, SESSÕES E PERMISSÕES
-------------------------------

- Somente a primeira conta pode ser criada sem login; ela recebe perfil Admin.
- Depois do primeiro cadastro, somente um Admin cria novas contas.
- As contas seguintes recebem perfil Técnico.
- Senhas possuem de 8 a 128 caracteres e são armazenadas como hash, nunca em
  texto puro.
- O Admin redefine senhas na aba Administração.
- Uma redefinição encerra as outras sessões abertas do usuário alterado.
- Exclusões definitivas de manutenções e IPs exigem perfil Admin.
- Sessões são persistidas no SQLite e sobrevivem à reinicialização.
- PDFs exigem autenticação, mesmo que alguém conheça o endereço do arquivo.

Se o único Admin esquecer a senha, não tente editar hashes manualmente sem um
procedimento técnico e um backup válido. Preserve o banco antes de qualquer
recuperação extraordinária.


6. RECURSOS DO SISTEMA
----------------------

Pendências:
- Cada usuário vê somente suas próprias pendências e seu próprio histórico.
- Cadastro de descrição, setor, data, hora, prioridade e status.
- Pesquisa no histórico de tarefas concluídas.
- Ao concluir uma tarefa semanal, o sistema cria somente uma próxima ocorrência
  para sete dias depois.

Equipamentos em manutenção:
- Lista e histórico compartilhados com a equipe.
- Tipo, patrimônio, marca/modelo, serial, setor/usuário, destino, data de envio,
  status, defeito e observações.
- Identificação de quem criou, editou e marcou o retorno.
- Retorno ao histórico, reabertura e exclusão autorizada.

PDFs:
- É possível selecionar vários PDFs no formulário.
- Para preservar a API existente, cada arquivo é enviado individualmente e
  associado à mesma manutenção.
- Nome original e usuário que anexou são mantidos.
- Os arquivos continuam disponíveis depois de marcar como retornado e depois
  de reabrir a manutenção.

Monitor de IPs:
- Cadastro, edição, pesquisa, verificação individual ou coletiva e exclusão
  autorizada.
- Nome/equipamento, categoria, IP, setor/local e observações.
- Estado online/offline, tempo de resposta e última verificação.
- Categorias: Relógio, Switch, Impressora, Access Point, Câmera, Servidor e Outro.


7. TELA DE DESCANSO
-------------------

- O botão "Tela de descanso" fica próximo de "Sair".
- A tela mostra hora, data, dia da semana, nome Rotina TI e usuário conectado.
- O modo manual é encerrado pelo botão de voltar ou pela tecla ESC.
- Clicar em uma área qualquer não fecha a tela.
- Após exatamente cinco minutos sem mouse ou teclado, ela é ativada
  automaticamente.
- Quando a ativação foi automática, movimento do mouse ou tecla retorna ao
  painel e reinicia o contador.
- Ela não é ativada na tela de login nem durante upload, requisição ou ação em
  andamento.
- Entrar e sair não recarrega a página e não apaga conteúdo digitado.
- O sistema usa o cursor normal do Windows.


8. ARQUIVOS QUE DEVEM SER PRESERVADOS
-------------------------------------

Dados operacionais:
- database.db: banco SQLite principal.
- database.db-wal: transações SQLite em modo WAL, quando existir.
- database.db-shm: estado compartilhado do WAL, quando existir.
- uploads/: todos os PDFs anexados.
- session-secret.txt: segredo local usado para assinar sessões, quando existir.

Também preserve o código do projeto, package.json e package-lock.json. Nunca
publique, envie por e-mail ou coloque em repositório público o segredo de
sessão, o banco ou os PDFs.

Perder session-secret.txt não apaga usuários ou tarefas, mas invalida sessões
existentes. Substituir uploads/ quebra o acesso aos PDFs registrados no banco.


9. BACKUP SEGURO
----------------

IMPORTANTE: não copie apenas database.db enquanto o servidor estiver em
execução. Transações confirmadas podem estar em database.db-wal.

Procedimento:
1. Avise os usuários e interrompa novas alterações.
2. Encerre o servidor com Ctrl+C e aguarde a janela finalizar.
3. Confirme que a instância do Rotina TI não está mais usando a porta 3000.
4. Crie uma pasta de backup com data e hora.
5. Copie como um conjunto consistente:

   database.db
   database.db-wal, se existir
   database.db-shm, se existir
   uploads/ completa
   session-secret.txt, se existir

6. Copie também package.json, package-lock.json e os arquivos do sistema.
7. Confira quantidade e tamanho dos PDFs e mantenha o backup em local protegido.

Uma cópia feita com o servidor parado é a opção operacional mais simples. Uma
ferramenta que use a API de backup online do SQLite também pode produzir uma
cópia consistente. Nunca misture database.db de uma data com WAL/SHM de outra.


10. ATUALIZAR SEM PERDER DADOS
------------------------------

1. Pare o servidor.
2. Faça e valide o backup completo descrito acima.
3. Preserve database.db, os sidecars WAL/SHM existentes, uploads/ e
   session-secret.txt.
4. Atualize somente os arquivos do programa. Não esvazie nem recrie o banco e
   não substitua uploads/ por uma pasta vazia.
5. Se package.json ou package-lock.json tiverem mudado, execute na pasta:

   npm.cmd install

6. Inicie por abrir-rotina-ti.bat.
7. Verifique login, pendências, manutenções, PDFs e monitor de IPs.

As atualizações de esquema do banco são automáticas e não destrutivas, mas o
backup anterior à atualização continua obrigatório.


11. RESTAURAR UM BACKUP
-----------------------

1. Pare completamente o Rotina TI.
2. Mova os dados atuais para uma pasta de segurança; não os apague diretamente.
3. Restaure para a pasta do projeto o conjunto da mesma data:

   database.db
   database.db-wal e database.db-shm, caso façam parte daquele backup
   uploads/
   session-secret.txt

4. Não combine banco de um backup com PDFs ou WAL de outro.
5. Inicie pelo BAT.
6. Confirme autenticação, registros, históricos e abertura de vários PDFs.

Se o backup não possuir WAL/SHM porque foi produzido por uma ferramenta de
backup SQLite consistente, restaure somente os arquivos fornecidos por ela.


12. VERIFICAR SE A PORTA 3000 ESTÁ OCUPADA
------------------------------------------

No Prompt de Comando:

netstat -ano | findstr :3000

No Windows PowerShell:

Get-NetTCPConnection -LocalPort 3000 -State Listen

O último número mostrado pelo netstat é o PID. Para identificar o processo:

tasklist /FI "PID eq NUMERO_DO_PID"

Não finalize processos desconhecidos. O BAT já diferencia o endpoint de saúde
do Rotina TI de outro programa e interrompe a inicialização quando há conflito.


13. VARIÁVEIS DE AMBIENTE E SEGURANÇA
-------------------------------------

.env.example é apenas um modelo de referência. O projeto não carrega arquivos
.env automaticamente. Defina variáveis no terminal, no serviço do Windows ou
na configuração usada para iniciar o processo.

Variáveis reconhecidas:
- PORT: porta HTTP. O BAT oficial fixa 3000.
- TZ: fuso horário; o padrão é America/Sao_Paulo.
- SESSION_SECRET: segredo com pelo menos 32 caracteres. Quando não informado, o
  sistema usa ou cria session-secret.txt.
- NODE_ENV: identificação opcional do ambiente (por exemplo, development ou
  production). Ela não força HTTPS nem altera a porta.
- SESSION_COOKIE_SECURE: mantenha false no HTTP padrão da rede local. Use true
  somente quando todo o acesso ocorrer por HTTPS; cookies seguros não são
  enviados por navegadores em endereços HTTP.
- UPLOAD_DIR: caminho absoluto opcional para a pasta final dos PDFs. Deixe vazio
  em uso normal para manter uploads\manutencoes. Alterar esse caminho não move
  arquivos antigos automaticamente.

Exemplo temporário no Windows PowerShell:

$env:SESSION_SECRET="um-segredo-aleatorio-com-mais-de-32-caracteres"
$env:NODE_ENV="development"
$env:SESSION_COOKIE_SECURE="false"

Não coloque senhas, tokens ou segredos no HTML/JavaScript do navegador. Não
exiba SESSION_SECRET em logs. Restrinja acesso ao servidor, aos backups e à
pasta do projeto conforme a política da empresa.


14. VALIDAÇÃO E DIAGNÓSTICO
---------------------------

Validação de sintaxe:

npm.cmd run check

Testes automatizados:

npm.cmd test

Testes que criam, editam, concluem ou excluem registros devem usar DB_PATH e
UPLOAD_DIR apontando para uma pasta temporária. Nunca execute testes destrutivos
no database.db ou em uploads/ reais.

Com o servidor iniciado, verifique a saúde no Windows PowerShell:

Invoke-RestMethod http://localhost:3000/api/health

O resultado esperado contém ok igual a true.

Em uma validação técnica que não deva abrir o navegador, defina
ROTINA_TI_NO_BROWSER=1 somente no terminal usado para executar o BAT. O uso
normal não precisa dessa variável.

Checklist funcional recomendado:
- Primeiro cadastro, login, logout e recuperação de senha por Admin.
- Privacidade, edição, conclusão, repetição semanal e histórico de pendências.
- Cadastro, edição, retorno, histórico e reabertura de manutenção.
- Seleção, upload e download de pelo menos dois PDFs.
- Preservação dos PDFs no histórico e após reabertura.
- Cadastro, edição, verificação individual/coletiva e exclusão de IP.
- Tela de descanso manual, ESC e retorno pelo botão.
- Ativação automática após cinco minutos e retorno por atividade.
- Ausência da tela de descanso no login e durante ações em andamento.
- Layout em aproximadamente 390 px, 768 px e desktop, sem rolagem horizontal.
- Segunda execução do BAT sem criar outra instância.
- Mensagem correta quando outro programa ocupa a porta 3000.


15. SOLUÇÃO RÁPIDA DE PROBLEMAS
-------------------------------

"Node.js não está instalado" ou "npm não foi encontrado":
- Instale/repare o Node.js LTS e abra novamente o BAT.

"Porta 3000 está ocupada":
- Use os comandos da seção 12, identifique o programa responsável e consulte o
  administrador antes de encerrá-lo.

O servidor abriu, mas outro computador não acessa:
- Teste primeiro http://localhost:3000 no ANDDSKTI01.
- Confirme a regra de firewall, o perfil de rede e a resolução DNS.
- Teste o IPv4 do servidor obtido com ipconfig.

PDF registrado, mas arquivo não encontrado:
- Confirme que uploads/ correto foi restaurado e que UPLOAD_DIR não aponta para
  outra pasta.

Sessão encerrou após restauração:
- Confirme que session-secret.txt do mesmo ambiente foi preservado. Faça login
  novamente; não substitua o segredo sem necessidade.
