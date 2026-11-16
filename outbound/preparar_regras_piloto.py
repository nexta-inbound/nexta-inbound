"""Gera regras de leitura do piloto. Nao publica e nao concede acesso a contas."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = (
    "auth != null && auth.token.central === true && "
    "auth.token.centralUid != null && "
    "root.child('liberacoesPiloto').child(auth.uid).val() === true && "
    "root.child('perfis').child(auth.uid).child('ativo').val() === true && "
    "root.child('perfis').child(auth.uid).child('centralUid').val() === auth.token.centralUid"
)
ADMIN = BASE + " && root.child('perfis').child(auth.uid).child('perfil').val() === 'administrador'"
INTERNO = BASE + " && (root.child('perfis').child(auth.uid).child('perfil').val() === 'administrador' || root.child('perfis').child(auth.uid).child('perfil').val() === 'interno')"


def build():
    rules = {'.read': False, '.write': False,
             'liberacoesPiloto': {'.read': False, '.write': False},
             'perfis': {'$uid': {'.read': BASE + ' && auth.uid === $uid', '.write': False}}}
    indexes = {
        'disponibilidades': ['carrier', 'plate', 'dateStr'],
        'bloqueiosDisponibilidade': ['carrier', 'dateStr'],
        'ciclos': ['carrier', 'status'],
        'programacaoDiaria': ['mes'],
        'devolucoesReentregas': ['criadoEm'],
        'simulacoesFrete': ['criadoEm'],
        'eventosOtimizador': ['criadoEm'],
        'arquivosHistoricos': ['key'],
    }
    for path, fields in indexes.items():
        rules[path] = {'.read': INTERNO, '.write': False, '.indexOn': ['dados/' + field for field in fields]}
    # Usuarios, proveniencia e parametros legados ficam restritos ao administrador.
    rules['configuracoesLegadas'] = {'.read': ADMIN, '.write': False}
    return {'rules': rules}


if __name__ == '__main__':
    path = ROOT / 'database.piloto.rules.json'
    path.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Rascunho gerado: database.piloto.rules.json. Nao publicado; todas as escritas de cliente bloqueadas.')
