# Pocket Repo（仮称）要件定義

## 概要

Claude Code等で開発中のリポジトリを、スマホやタブレットから快適に閲覧するためのローカル専用リポジトリビューア。

GitHubやVSCodeはデスクトップ中心のUIであり、スマホからの確認には不向きである。

本プロダクトは「スマホから開発中の状態を確認する」ことに特化し、GitHub MobileとVSCodeの中間的な体験を提供する。

MVPではファイル編集、Git操作、Claude Code / Codex への指示送信は行わない。基本的にはlocalhostでHTTPサーバーを起動し、ブラウザから閲覧するread-onlyツールとする。

---

## 解決したい課題

現状

* Claude Codeをサーバー上で常時稼働
* SSH接続先に複数リポジトリが存在
* worktreeを利用して並列開発
* スマホから状況確認したい

しかし

* VSCode ServerはモバイルUIが悪い
* OpenVSCode Serverも重い
* GitHubはコミット済みの状態しか見えない
* 未コミット変更の確認が面倒

結果として

* README確認だけでもPCを開く
* 差分確認だけでもSSH接続する

という状態になっている。

---

## ターゲットユーザー

一次ターゲット

* Claude Code利用者
* Cursor利用者
* OpenHands利用者
* リモートサーバー開発者

二次ターゲット

* 個人開発者
* VPS利用者
* ホームラボ運用者

---

## コアコンセプト

GitHub Mobile + git status + worktree

スマホから「GitHubのリポジトリコード画面を見る感覚」で、ローカル作業中のリポジトリ、worktree、未コミット差分を確認できる。

---

## MVP方針

### スコープ

MVPで提供するもの

* リポジトリ一覧
* 一度開いたリポジトリの履歴保存
* GitHub風のコード閲覧画面
* Worktree一覧
* ファイルブラウザ
* コードビューア
* Markdownプレビュー
* Git Status表示
* Diff Viewer
* リポジトリ内検索

MVPで提供しないもの

* ファイル編集
* git commit / checkout / pull / push などのGit操作
* Claude Code / Codex / Cursor / OpenHands への指示送信
* 外部公開機能
* 認証機能
* 複数ユーザー管理

### 実行形態

* ローカルHTTPサーバーとして起動する
* デフォルトではlocalhostでのみ閲覧する
* 外部公開したい場合は、ユーザーがCloudflare Tunnel等を別途利用する
* Pocket Repo自体は外部公開や認証を責務に含めない

### 設定・履歴

* 一度開いたリポジトリを記憶する
* VSCodeのrecent workspaceのように、最近開いたリポジトリへ素早く戻れる
* 設定や履歴は `~/.pocket-repo` 配下に保存する
* 想定する保存情報
  * 最近開いたリポジトリパス
  * 表示名
  * 最終閲覧日時
  * ユーザー設定
  * UI設定

---

## 画面構成

基本的にはGitHub Webのリポジトリコード閲覧画面に近い構成とする。

想定画面

* リポジトリ選択画面
* リポジトリトップ画面
* ブランチ / worktree切り替え
* ファイルブラウザ
* ファイルビューア
* Markdownプレビュー
* Git Status画面
* Diff Viewer
* 検索結果画面

---

## リポジトリ一覧

表示内容

* リポジトリ名
* パス
* ブランチ数
* Worktree数
* Dirty状態
* 最終閲覧日時

例

repo-a
├ main
├ feature/login
└ feature/payment

---

## Worktree一覧

表示内容

* パス
* ブランチ
* HEADコミット
* Dirty状態

例

feature/login
Modified 12 files

---

## ファイルブラウザ

機能

* ディレクトリ一覧
* ファイル一覧
* パンくずリスト
* ファイル検索
* GitHub風のディレクトリ表示
* ファイル種別アイコン
* 最終更新情報の表示

対象

* Git管理対象
* Git管理対象外

両方

---

## コードビューア

機能

* シンタックスハイライト
* 行番号
* 折りたたみ
* スマホで読みやすい横スクロール
* GitHub風のコード表示

対応

* TypeScript
* JavaScript
* JSON
* YAML
* Markdown
* Python
* Shell

---

## Markdownプレビュー

機能

* GitHub互換表示
* ダークモード
* 見出しジャンプ
* コードブロックのシンタックスハイライト

対象

* README
* docs

---

## Git Status

表示

Modified
Added
Deleted
Renamed
Untracked

例

M src/app/page.tsx
A src/components/Button.tsx
?? debug.log

---

## Diff Viewer

機能

* ファイル単位差分
* インライン差分
* GitHub風表示
* 追加・削除行のハイライト
* スマホで見やすい折り返し・横スクロール

対象

* unstaged
* staged

---

## 検索

機能

* ripgrep利用
* 全文検索

例

"createCustomer"

検索結果

src/customer.ts:18
src/customer.test.ts:51

---

## 非機能要件

### セキュリティ

* read-onlyを前提とする
* ファイル編集やGit操作を行わない
* デフォルトではlocalhostでのみ待ち受ける
* 認証や外部公開はMVPの責務に含めない

### パフォーマンス

* 大きいリポジトリでも軽く閲覧できる
* ファイル一覧や検索は必要に応じて遅延取得する
* 全文検索はripgrepを利用する
* 重い処理でUIをブロックしない

### UI / UX

* スマホ優先UI
* タブレットでも快適に閲覧できる
* GitHub Webのコード閲覧画面に近い情報設計
* ダークモードを重視する
* PCを開かずに状況確認できることを最優先にする

### 対応環境

* Linuxサーバー上での利用を主対象とする
* ブラウザから閲覧する
* モバイルブラウザでの利用を主対象とする

---

## v1以降の拡張候補

MVPでは閲覧専用に絞る。以下はMVP後の拡張候補として扱う。

### Claude Code連携

表示

* セッション一覧
* 作業中リポジトリ
* 最終実行時刻

例

Session #12
feature/login

---

### tmux連携

表示

* セッション一覧
* ペイン数
* 実行コマンド

---

### ログビューア

対象

* application.log
* worker.log

機能

* tail
* 検索
* フィルタ

---

## 将来検討

以下はプロダクトの方向性次第で検討するが、現時点ではMVPにもv1にも含めない。

### 編集機能

機能

* 保存
* Undo

---

### Worktree作成

機能

* ブランチ選択
* worktree作成

---

### ブランチ切替

機能

* checkout
* fetch

---

## 詳細な非機能要件

### デバイス

対応

* iPhone
* Android
* iPad
* Android Tablet
* Desktop Browser

---

### パフォーマンス目標

リポジトリ表示

* 500ms以内

ファイル表示

* 300ms以内

検索開始

* 1秒以内

---

### セキュリティ方針

MVP

* 認証機能は持たない
* 外部公開機能は持たない
* localhostでの利用を基本とする
* 必要に応じたCloudflare Tunnel、Tailscale、Basic Auth等はユーザーが外側で構成する

---

## 技術構成

Frontend

* Next.js
* shadcn/ui
* CodeMirror 6

Backend

* Node.js
* Hono

Git

* git CLI

検索

* ripgrep

Markdown

* react-markdown

デプロイ

* Docker

---

## 成功指標

1週間後

* README確認のためにPCを開く回数が減る

1ヶ月後

* スマホから差分確認が日常的になる

3ヶ月後

* VSCode Serverを開く回数が大幅に減る

最終的には

「開発状況の確認はすべてPocket Repoで行う」
状態を目指す。
