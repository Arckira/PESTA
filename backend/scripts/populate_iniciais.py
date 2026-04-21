import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from sqlmodel import Session, select
from database import engine
from models import Utilizador


def calculate_initials(nome: str) -> str:
    if not nome:
        return ''
    parts = [p for p in nome.strip().split() if p]
    if not parts:
        return ''
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def main():
    with Session(engine) as session:
        users = session.exec(select(Utilizador)).all()
        updated = 0
        for u in users:
            current = (u.iniciais or '').strip()
            if not current:
                new = calculate_initials(u.nome)
                u.iniciais = new
                session.add(u)
                updated += 1
                print(f"Updating user id={u.id} nome='{u.nome}' -> iniciais='{new}'")
        if updated > 0:
            session.commit()
        print(f"Done. {updated} users updated.")


if __name__ == '__main__':
    main()
