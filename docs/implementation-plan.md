# Pocket Repo 実装計画

## 方針

まずread-onlyの閲覧体験を最短で成立させる。Git操作、ファイル編集、認証、外部公開はMVPから外す。

## Phase 0: プロジェクト土台

目的

* アプリケーションを起動できる状態にする

タスク

* Next.jsアプリを作成する
* Backend APIの実行方式を決める
* Honoを組み込む
* `~/.pocket-repo` の初期化処理を作る
* 基本レイアウトを作る

完了条件

* localhostで画面を表示できる
* `/api/health` が成功する
* `~/.pocket-repo` が作成される

## Phase 1: リポジトリ履歴

目的

* 一度開いたリポジトリを記憶できるようにする

タスク

* `config.json` と `recent-repositories.json` の読み書き
* リポジトリパスの検証
* `POST /api/repositories/open`
* `GET /api/repositories`
* リポジトリ選択画面

完了条件

* パス入力でリポジトリを開ける
* 最近開いたリポジトリに表示される
* 再起動後も履歴が残る

## Phase 2: Git情報

目的

* リポジトリの状態を把握できるようにする

タスク

* 現在ブランチ取得
* ブランチ数取得
* `git worktree list --porcelain` のパース
* `git status --porcelain=v1 -z` のパース
* リポジトリ概要API
* Worktree一覧API

完了条件

* リポジトリトップにブランチ、worktree、dirty状態が表示される
* Worktree一覧を確認できる

## Phase 3: ファイル閲覧

目的

* GitHub風にファイルを辿って読めるようにする

タスク

* ディレクトリ一覧API
* ファイル本文API
* パストラバーサル対策
* ファイルブラウザUI
* コードビューアUI
* Markdownプレビュー

完了条件

* ディレクトリを移動できる
* コードファイルを読める
* READMEをMarkdownとして読める

## Phase 4: Status / Diff

目的

* 未コミット変更をスマホで確認できるようにする

タスク

* Status API
* Diff API
* staged / unstagedの切り替え
* GitHub風Diff Viewer
* スマホでの横スクロール、折り返し調整

完了条件

* Modified / Added / Deleted / Renamed / Untrackedを一覧できる
* ファイル単位で差分を確認できる

## Phase 5: 検索

目的

* リポジトリ内を全文検索できるようにする

タスク

* ripgrep実行
* JSON出力のパース
* 検索API
* 検索結果画面
* 検索結果からファイルビューアへの遷移

完了条件

* クエリでリポジトリ内検索ができる
* 該当ファイルと行番号を開ける

## Phase 6: 仕上げ

目的

* 日常利用できる品質にする

タスク

* ダークモード
* モバイル表示調整
* エラー表示
* ローディング表示
* 大きいファイルの扱い
* バイナリファイルの扱い
* READMEなしリポジトリの表示

完了条件

* スマホから主要フローをストレスなく使える
* 大きいリポジトリでも基本操作が破綻しない

