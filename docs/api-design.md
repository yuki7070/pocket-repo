# Pocket Repo API設計

## 方針

FrontendはHTTP API経由でBackendから情報を取得する。MVPではread-only APIのみ提供する。

APIはJSONを基本とする。ファイル本文やDiffなど大きくなりうるレスポンスは、必要なタイミングで個別に取得する。

## 共通仕様

### Base URL

```text
http://127.0.0.1:4545/api
```

### エラー形式

```json
{
  "error": {
    "code": "REPOSITORY_NOT_FOUND",
    "message": "Repository not found"
  }
}
```

### 主なエラーコード

* `INVALID_REQUEST`
* `REPOSITORY_NOT_FOUND`
* `PATH_OUTSIDE_REPOSITORY`
* `FILE_NOT_FOUND`
* `UNSUPPORTED_BINARY_FILE`
* `GIT_COMMAND_FAILED`
* `SEARCH_FAILED`

## Repositories

### 最近開いたリポジトリ一覧

```http
GET /api/repositories
```

レスポンス

```json
{
  "repositories": []
}
```

### リポジトリを開く

```http
POST /api/repositories/open
```

リクエスト

```json
{
  "path": "/home/user/Develop/pocket-repo"
}
```

レスポンス

```json
{
  "repository": {
    "id": "repo_01JXYZ...",
    "name": "pocket-repo",
    "path": "/home/user/Develop/pocket-repo"
  }
}
```

このAPIはファイル編集やGit操作ではなく、閲覧対象として履歴に登録するためのAPIとする。

### リポジトリ概要

```http
GET /api/repositories/:repositoryId
```

取得内容

* 表示名
* パス
* 現在ブランチ
* ブランチ数
* worktree数
* dirty状態

## Worktrees

### Worktree一覧

```http
GET /api/repositories/:repositoryId/worktrees
```

取得元

* `git worktree list --porcelain`
* 各worktreeでの `git status --porcelain`

## Files

### ディレクトリ一覧

```http
GET /api/repositories/:repositoryId/files?path=src
```

レスポンス

```json
{
  "path": "src",
  "entries": []
}
```

### ファイル本文

```http
GET /api/repositories/:repositoryId/file?path=README.md
```

レスポンス

```json
{
  "path": "README.md",
  "language": "markdown",
  "size": 2048,
  "content": "# Pocket Repo\n",
  "binary": false
}
```

## Git Status

### Status取得

```http
GET /api/repositories/:repositoryId/status
```

取得元

* `git status --porcelain=v1 -z`

レスポンス

```json
{
  "entries": []
}
```

## Diff

### ファイル差分

```http
GET /api/repositories/:repositoryId/diff?path=src/app/page.tsx&target=unstaged
```

クエリ

* `path`: 対象ファイルパス
* `target`: `unstaged` または `staged`

取得元

* unstaged: `git diff -- path`
* staged: `git diff --cached -- path`

レスポンス

```json
{
  "path": "src/app/page.tsx",
  "target": "unstaged",
  "patch": "diff --git ..."
}
```

## Search

### リポジトリ内検索

```http
GET /api/repositories/:repositoryId/search?q=createCustomer
```

取得元

* `rg --line-number --column --json`

レスポンス

```json
{
  "query": "createCustomer",
  "results": []
}
```

## Settings

### 設定取得

```http
GET /api/settings
```

### 設定更新

```http
PATCH /api/settings
```

設定更新はPocket Repo自身のUI設定に限る。リポジトリ内ファイルやGit状態は変更しない。

