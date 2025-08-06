# Chat-with-Files

A multi-service application that processes PDF uploads, extracts text (via OCR for scanned documents), generates embeddings with a local FastAPI service, and indexes the results in Qdrant for semantic search.

## Folder Structure

```bash
chat-with-files/
├── client/           # Frontend application
├── embed-server/     # Local FastAPI embedding service
├── server/           # Main worker/service handling PDF uploads, OCR, embedding, and indexing
├── docker-compose.yml
└── .gitignore        # Root-level ignore rules
```

## Prerequisites

### System Dependencies

These tools must be installed globally (via Homebrew or your OS package manager):

```bash
# macOS (Homebrew)
brew install graphicsmagick    # PDF-to-image conversion
brew install poppler           # Poppler utilities (pdftoppm)
brew install ghostscript       # Ghostscript delegate for gm/convert

# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y graphicsmagick poppler-utils ghostscript

# Fedora/CentOS
sudo dnf install -y GraphicsMagick poppler-utils ghostscript
```

### Node.js & PNPM

* Node.js `>=14.x`
* PNPM (or npm/yarn)

## Setup

1. **Clone the repository**

   ```bash
   ```

git clone [git@github.com](mailto:git@github.com)\:your-org/chat-with-files.git
cd chat-with-files

````

2. **Apply `.gitignore` rules** (only needed once)
   ```bash
git rm -r --cached .
git add .
git commit -m "chore: apply .gitignore"
````

3. **Install dependencies**

   * Root-level (for Docker Compose)

     ```bash
     ```

# if you use Yarn or npm, install globally

pnpm install

````
   - **Client**
     ```bash
cd client
pnpm install
````

* **Embed Server**

  ```bash
  ```

cd ../embed-server
pnpm install

````
   - **Server**
     ```bash
cd ../server
pnpm install
````

## Running the Application

You can use Docker Compose to bring up all services together:

```bash
docker-compose up --build
```

Alternatively, start each service manually:

1. **Embed Server**

   ```bash
   ```

cd embed-server
pnpm dev

````

2. **Worker Server**
   ```bash
cd ../server
pnpm dev
````

3. **Client**

   ```bash
   ```

cd ../client
pnpm dev

```

## Usage

1. Upload a PDF via the client UI.
2. The server worker will:
   - Attempt to extract text with `@langchain/community` PDFLoader.
   - If no text is found, fall back to OCR (Tesseract via node-tesseract-ocr).
   - Split the text into chunks.
   - Call the local embed-server to generate embeddings.
   - Index the embeddings in Qdrant under `pdf-docs` collection.
3. Use the client search interface to query the indexed documents semantically.

## `.gitignore` Guidelines

See the root `.gitignore` for patterns covering:
- Node modules
- Build outputs
- System artifacts (logs, OS files, IDE folders)
- Service-specific folders (`server/uploads/`, OCR temp files)

Service-level folders (`client/`, `embed-server/`, `server/`) each contain their own `.gitignore` for local artifacts.

AI generated README