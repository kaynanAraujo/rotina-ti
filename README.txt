Rotina TI Server v2.0

Versão com:
- Login e criar conta
- SQLite local
- Pendências privadas por usuário
- Equipamentos em manutenção compartilhados
- Identificação de quem criou/editou/retornou
- Anexo PDF na manutenção com identificação de quem anexou
- Acesso via navegador

Como usar no PC principal:
1. Instale o Node.js LTS.
2. Abra a pasta do projeto.
3. Clique duas vezes em abrir-rotina-ti.bat.
4. Acesse http://localhost:3000.

Para outras pessoas acessarem:
1. Descubra o IP do PC principal com ipconfig.
2. Libere a porta 3000 no firewall, se necessário.
3. Nos outros PCs, acesse http://IP-DO-PC:3000.

Backup importante:
- database.db guarda os dados.
- uploads/ guarda os PDFs anexados.
- Copie ambos para backup.

Observação:
- A primeira conta criada vira Admin.
- As próximas contas entram como Técnico.


Acesso por nome do PC:
- No PC principal: http://localhost:3000
- Nos outros PCs da rede: http://NOME-DO-PC:3000
- Exemplo do Kaynan no serviço: http://ANDDSKTI01:3000

Se outros PCs não abrirem, libere a porta 3000 no firewall do PC principal.

Atualização: o formulário de manutenção agora tem campo para anexar PDF já no cadastro/edição. Também continua sendo possível anexar PDFs depois, no card da manutenção.
