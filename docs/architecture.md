# Pocket Repo 全体設計

## 目的

Pocket Repoは、ローカルまたはリモートサーバー上の開発中リポジトリを、スマホやタブレットのブラウザから快適に閲覧するためのread-onlyリポジトリビューアである。

MVPではファイル編集、Git操作、外部公開、認証を扱わない。アプリケーションはlocalhostでHTTPサーバーとして起動し、ブラウザUIからリポジトリの状態、ファイル、Markdown、差分、検索結果を閲覧する。

## 基本構成

```text
Mobile Browser / Desktop Browser
        |
        | HTTP
        v
Pocket Repo Web Server
        |
        | internal API
        v
Application Services
        |
        +-- Config Store (~/.pocket-repo)
        +-- Git CLI
        +-- ripgrep
        +-- File System
```

## コンポーネント

### Frontend

役割

* GitHub Webのリポジトリコード画面に近いUIを提供する
* スマホ優先でファイル一覧、コード、Markdown、Diff、検索結果を表示する
* read-onlyの閲覧体験に集中する

想定技術

* Next.js
* shadcn/ui
* CodeMirror 6
* react-markdown

### Backend

役割

* リポジトリ履歴と設定を管理する
* Git情報をGit CLIから取得する
* ファイルシステムを安全に読み取る
* ripgrepで検索する
* Frontend向けAPIを提供する

想定技術

* Node.js
* Hono
* Git CLI
* ripgrep

### Config Store

役割

* 一度開いたリポジトリを記録する
* UI設定やユーザー設定を保存する
* `~/.pocket-repo` 配下で管理する

想定ファイル

```text
~/.pocket-repo/
  config.json
  recent-repositories.json
```

## 主要フロー

### 初回起動

1. Pocket Repoサーバーを起動する
2. `~/.pocket-repo` がなければ作成する
3. ブラウザでlocalhostにアクセスする
4. リポジトリパスを指定して開く
5. 開いたリポジトリを履歴に保存する

### リポジトリ閲覧

1. 最近開いたリポジトリ一覧から選択する
2. Git情報、worktree、dirty状態を取得する
3. リポジトリトップ画面を表示する
4. ディレクトリ移動やファイル閲覧を行う

### 差分確認

1. Git Status画面を開く
2. staged / unstaged / untrackedの状態を表示する
3. ファイルを選択する
4. GitHub風のDiff Viewerで差分を表示する

### 検索

1. 検索クエリを入力する
2. Backendがripgrepを実行する
3. ファイルパス、行番号、該当行を返す
4. 検索結果からファイルビューアへ遷移する

## 境界と制約

### MVPで扱う境界

* read-only
* localhost利用
* 単一ユーザー
* Git管理対象とGit管理対象外の両方を閲覧対象にする
* Git操作は情報取得のみ

### MVPで扱わない境界

* ファイル編集
* Gitの状態変更
* 認証
* 外部公開
* 複数ユーザー管理
* Claude Code / Codexへの指示送信

## セキュリティ方針

* デフォルトのlisten hostは `127.0.0.1` とする
* APIは登録済み、または明示的に開いたリポジトリ配下のみを読み取る
* パストラバーサルを防ぐため、API入力のパスは必ずリポジトリルート配下に正規化して検証する
* write系APIはMVPでは提供しない

## パフォーマンス方針

* 大きいリポジトリを想定し、ディレクトリ一覧や検索は必要な範囲だけ取得する
* ファイル本文は開いたタイミングで取得する
* Git statusやworktree情報は短時間キャッシュを検討する
* 検索はripgrepに委譲する

