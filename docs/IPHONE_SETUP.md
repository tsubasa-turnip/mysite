# iPhoneでInner Weatherを開く準備

公開先は **Vercel + Supabase** を使います。Codex内のポート3000をiPhoneから直接開くことはできません。Codexのクラウド環境の公開と、Webアプリのデプロイは別の操作です。

## 1. アカウントを作成する

- [Supabase](https://supabase.com/dashboard) にサインアップし、専用プロジェクトを作成します。無料枠で始める場合は Free を選択します。DBパスワードはパスワード管理アプリなどに保存します。
- [Vercel](https://vercel.com/signup) に GitHub でサインアップします。個人の検証用途で無料枠を使う場合は Hobby を選択します。料金・利用条件は作成画面で確認してください。

この2つのサービスで本人のログイン・確認操作が必要です。APIキーとDBパスワードをチャットに送る必要はありません。

## 2. Supabaseにテーブルを作成する

1. プロジェクトの **SQL Editor** を開きます。
2. [`supabase/migrations/001_inner_weather.sql`](../supabase/migrations/001_inner_weather.sql) の全文を貼り付けて実行します。専用プロジェクトにのみ適用してください。
3. **Authentication → Providers** で Email / Password を有効にします。メール確認を有効にしたまま使えます。
4. **Connect → Direct / Connection string** を選び、**Method → Transaction pooler** の PostgreSQL URL を取得します。`[YOUR-PASSWORD]`をDBパスワードで差し替え、特殊文字をURLエンコードしてください。DBパスワードを忘れた場合は、**Database → Settings → Reset database password** で再設定します。
5. Project SettingsのAPI設定から Project URL を、**API Keys** から publishable / anon key を取得します。Publishable keyは`sb_publishable_`で始まる値です。Legacy API Keysを使う場合は`anon / public`を選びます。

DB接続にはTLS検証を使います。接続失敗時に証明書検証を無効化せず、必要ならSupabaseが提供する正規のCA証明書を使用してください。

## 3. Vercelのプロジェクトを設定する

GitHubに実装ブランチ `codex/inner-weather-iphone` があることを確認します。`master` には元の「Hello, World」の静的ページがあります。Vercelは初回Importで`master`を選ぶ場合があるため、実装ブランチのデプロイとProductionへの切り替えを別途行います。

1. Vercelで **Add New → Project** を開き、`tsubasa-turnip/mysite` を選択します。GitHub連携でこのリポジトリへのアクセスを許可します。
2. 初回Importが`master`で公開され、「Hello, World」が表示された場合は、そのプロジェクトを使って次の設定を続けます。
3. 実装は **Next.js**、Root Directoryはリポジトリのルートです。実装ブランチの`vercel.json`がframeworkとビルドコマンドを指定します。**Settings → Domains**に表示される実際のドメインを確認し、`https://`を付けた値を`APP_ORIGIN`に使います。`<プロジェクト名>.vercel.app`は説明用の例で、実際のドメインはプロジェクト名だけから決められません。
4. Node.jsは **24.x** を指定します。インストールとビルドのコマンドは `vercel.json` にあります。Vercelでのアップロード上限はビルド・実行時とも未設定でも4 MBになります。
5. 以下を **Environment Variables** に1項目ずつ登録します。**Key**に変数名、**Value**に値を入れます。接続文字列・APIキー・暗号鍵は **Secret**、公開URLは **Config** を選びます。Previewで先にビルドする場合はPreviewにも必要な設定を登録します。`NEXT_PUBLIC_`を付けず、値をGitHubへコミットしないでください。

| 名前                        | 入れる値                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`              | Supabase transaction poolerの接続文字列                          |
| `SUPABASE_URL`              | `https://<project-ref>.supabase.co`                              |
| `SUPABASE_ANON_KEY`         | Supabase publishable / anon key                                  |
| `DATA_ENCRYPTION_KEY`       | 安全に生成した32バイトの鍵を64桁の16進数で表した値               |
| `APP_ORIGIN`                | このアプリを開く実際のHTTPS origin。末尾の `/` は付けない        |
| `SUPABASE_SERVICE_ROLE_KEY` | 任意。アカウント完全削除を利用する場合のサーバー専用キー         |
| `OPENAI_API_KEY`            | 任意。生成AI・文字起こしを使う場合のみ。最初は未設定で構いません |

暗号鍵は信頼できる端末で `openssl rand -hex 32` を実行して生成します。表示された鍵をVercelの設定へ直接コピーし、別途安全にバックアップします。鍵を失うと本文を復号できません。Codexの秘密変数名に制約がある場合のOpenAI設定はREADMEを参照してください。

端末にターミナルがない場合は、SupabaseのSQL Editorで以下を実行して生成できます。まだ暗号化した日記を保存していない初回設定向けです。保存済みデータがある場合は元の鍵を維持してください。

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT encode(gen_random_bytes(32), 'hex') AS encryption_key;
```

結果の表に出るセルの内容（`0`〜`9`と`a`〜`f`からなる64文字）だけを`DATA_ENCRYPTION_KEY`のValueへコピーします。SQLの文、列名`encryption_key`、引用符、改行を含めません。秘密の値をチャットやスクリーンショットに載せず、Vercelと安全なバックアップ先へ直接保存してください。

`INNER_WEATHER_LOCAL` は設定しません。実際のドメインが予定と変わった場合は `APP_ORIGIN` を更新して再デプロイします。PreviewとProductionのURLは異なるため、それぞれ使うURLに合わせて設定します。複数環境はDBと暗号鍵も分けてください。

公開前の設定確認は次で実行できます。外部通信・課金・マイグレーションは行いません。

```bash
npm run check:deploy
```

Vercelのビルドでも同じ確認を実行します。設定不足やHTTPのorigin、開発用DBモードの場合は公開用ビルドを止めます。形式の確認だけなので、Supabase実接続の成功を保証するものではありません。

## 4. デプロイして認証URLを設定する

設定内容と公開対象を確認してからデプロイします。GitHub連携済みのVercelでは、実装ブランチへの新しいコミットでも自動でPreviewが作られます。手動の場合は **Deployments → Create Deployment** でブランチ名`codex/inner-weather-iphone`を指定します。料金の発生するプラン・追加サービスは別途確認してください。

Productionのブランチを切り替える順序は次のとおりです。

1. 必要な環境変数を登録し、実装ブランチをPreviewでデプロイします。
2. デプロイが **Ready** になった後、**Settings → Environments → Production → Branch Tracking** に`codex/inner-weather-iphone`を入れて **Save** します。`No deployments found`の場合は、先にこのブランチのデプロイを成功させてください。
3. Productionの環境変数を確認し、同じブランチを再デプロイします。

PreviewのURLとProductionのURLは異なります。`APP_ORIGIN`がProductionのURLのままのPreviewではログイン等が403になるため、Previewを実際に操作する場合はそのURLへ設定を合わせて再デプロイします。Production設定を変える必要はありません。公開用ドメインでの確認は、Productionのデプロイが成功してから行います。

1. Vercelの **Domains** に表示されたアプリURLをコピーします。
2. `APP_ORIGIN` がそのURLのoriginと一致することを確認します。異なる場合は設定を変更し、再デプロイします。
3. Supabaseの **Authentication → URL Configuration** で **Site URL** を同じHTTPS URLに設定します。確認メールのリンクにも使われます。
4. SafariでそのURLを開き、「はじめての方はこちら」からアカウントを作成します。確認メールが届いた場合は先にメールを確認し、パスワードでログインします。

公開後の設定を変更したときはVercelで再デプロイしてください。開発用アカウントやCodex内のデータは自動移行されません。必要な記録はJSONで書き出して保持し、ChatGPT原文は公式エクスポートから公開先へインポートしてください。一般のInner WeatherバックアップJSONの再取り込みは未実装です。

## 5. iPhoneのホーム画面に追加する

1. **Safari** で発行されたアプリURLを開きます。
2. **共有 → ホーム画面に追加 → 追加** を選びます。iOSのバージョンによって「Webアプリとして開く」が表示された場合は有効にします。
3. ホーム画面の **Inner Weather** アイコンから開きます。Safariとはログイン状態が分かれる場合があるので、必要に応じて再度ログインします。

ホーム画面用のアイコン・Web Manifest・独立したウィンドウ表示を用意しています。ネット接続は必要です。日記をオフラインキャッシュするService Workerは導入していません。

## 6. iPhoneで最初に確認すること

合成の記録で次を確認してから、個人の日記を入力してください。

- 日記の作成・編集・削除ができ、再読み込み後も保存されている。
- ファイルアプリから4 MB以下のChatGPT ZIP / JSONを選べ、プレビュー後にインポートできる。
- 候補の感情と日付を修正し、グラフと原文リンクに反映される。
- HTTPS上でマイクを許可して録音できる。文字起こしにはOpenAI設定とアプリ内の送信同意が必要。
- ホーム画面から開いたとき、下部ナビゲーションがホームインジケーターに重ならない。

VercelのFunctionには約4.5 MBのリクエスト上限があるため、この構成ではファイル上限を4 MBにしています。大きなChatGPTエクスポートは、展開したJSONも4 MBを超える場合、最大25 MB対応のコンテナ構成が必要です。大容量の直接Storageアップロードは未実装です。

音声ファイルもVercel構成では4 MB以下です。画面とサーバーの双方で上限を確認します。

ブラウザを閉じるとインポート処理はいったん止まり、次に開くと続きから進みます。閉じている間も進めたい場合はREADMEの常駐ワーカーまたはPOSTスケジューラーを設定します。

## 現在の検証範囲

コードのテスト・ビルドとiPhoneサイズのChromium検証を行っています。Supabase/OpenAIの実接続、発行されたURL、iPhone実機Safariの動作は、接続設定とデプロイが済んでから別途検証する必要があります。
