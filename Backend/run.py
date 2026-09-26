import uvicorn
from app.main import app

if __name__ == "__main__":
    # host 0.0.0.0 garante escuta para os telemóveis (QR Codes); reload=False em produção.
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)