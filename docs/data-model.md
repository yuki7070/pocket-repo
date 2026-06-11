# Pocket Repo データモデル設計

## 方針

MVPでは永続化するデータを最小限にする。リポジトリそのものの状態はGitとファイルシステムを正とし、Pocket Repoは最近開いたリポジトリやUI設定だけを `~/.pocket-repo` に保存する。

## 保存先

```text
~/.pocket-repo/
  config.json
  recent-repositories.json
```

## config.json

アプリケーション全体の設定を保存する。

```json
{
  "version": 1,
  "server": {
    "host": "127.0.0.1",
    "port": 4545
  },
  "ui": {
    "theme": "system",
    "codeFontSize": 13,
    "lineWrap": false
  }
}
```

### フィールド

* `version`: 設定ファイルのスキーマバージョン
* `server.host`: HTTPサーバーのlisten host
* `server.port`: HTTPサーバーのlisten port
* `ui.theme`: `system`、`light`、`dark`
* `ui.codeFontSize`: コード表示のフォントサイズ
* `ui.lineWrap`: コード表示の折り返し設定

## recent-repositories.json

一度開いたリポジトリの履歴を保存する。

```json
{
  "version": 1,
  "repositories": [
    {
      "id": "repo_01JXYZ...",
      "name": "pocket-repo",
      "path": "/home/user/Develop/pocket-repo",
      "lastOpenedAt": "2026-06-11T12:00:00.000Z",
      "createdAt": "2026-06-11T12:00:00.000Z"
    }
  ]
}
```

### Repository

* `id`: Pocket Repo内部で使う安定ID
* `name`: 表示名。初期値はディレクトリ名
* `path`: リポジトリルートの絶対パス
* `lastOpenedAt`: 最終閲覧日時
* `createdAt`: 初回登録日時

## APIレスポンス上のモデル

### RepositorySummary

```json
{
  "id": "repo_01JXYZ...",
  "name": "pocket-repo",
  "path": "/home/user/Develop/pocket-repo",
  "currentBranch": "main",
  "branchCount": 8,
  "worktreeCount": 3,
  "dirty": true,
  "lastOpenedAt": "2026-06-11T12:00:00.000Z"
}
```

### WorktreeSummary

```json
{
  "path": "/home/user/Develop/pocket-repo-feature",
  "branch": "feature/mobile-ui",
  "head": {
    "hash": "abc1234",
    "message": "Add mobile repository view"
  },
  "dirty": true,
  "modifiedFileCount": 12
}
```

### FileEntry

```json
{
  "name": "src",
  "path": "src",
  "type": "directory",
  "gitStatus": null,
  "size": null,
  "lastModifiedAt": "2026-06-11T12:00:00.000Z"
}
```

`type` は `file` または `directory` とする。

### FileContent

```json
{
  "path": "README.md",
  "language": "markdown",
  "size": 2048,
  "content": "# Pocket Repo\n",
  "binary": false
}
```

### GitStatusEntry

```json
{
  "path": "src/app/page.tsx",
  "originalPath": null,
  "status": "modified",
  "staged": false
}
```

`status` は `modified`、`added`、`deleted`、`renamed`、`untracked` を基本とする。

### SearchResult

```json
{
  "path": "src/customer.ts",
  "line": 18,
  "column": 12,
  "preview": "const customer = createCustomer(input)"
}
```

## ID方針

* リポジトリIDはパスから毎回算出せず、初回登録時に生成する
* パス変更やディレクトリ名変更がある場合は、履歴上は別リポジトリとして扱ってよい
* ファイルやworktreeは永続IDを持たず、パスを識別子として扱う

