import type { Metadata } from 'next';
import { ExternalLink, LegalPage, LegalTable } from '@/components/legal/LegalPage';
import { formatLegalDate, LEGAL_VERSION } from '@/lib/site';

// 公開版（このファイルが正）。原稿は手元の docs/legal/privacy-policy.md（git には入れない。原稿との違いはその冒頭に記載）。
// 書いてある内容（Cookie の属性・保存するもの・送り先）は実装と合わせる：src/lib/server/session.ts、
// src/lib/current-use.ts、next.config.mjs（HSTS）、販売ページへのリンクの rel="noreferrer"、KV に保存するもの（cachePutJSON）
export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description: 'コスメ探偵（CosmeTantei）のプライバシーポリシーです。取得する情報、外部のサービスへの送信、電気通信事業法の外部送信規律に基づく公表事項を記載しています。',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="コスメ探偵（CosmeTantei） プライバシーポリシー" enactedOn={formatLegalDate(LEGAL_VERSION)}>
      <p>
        コスメ探偵（以下「当サービス」といいます。）の運営者（以下「当方」といいます。）は、ウェブサービス「コスメ探偵（CosmeTantei）」（https://cosmetantei.app、以下「本サイト」といいます。）において取り扱う利用者の情報（以下「利用者情報」といいます。）の保護について、個人情報の保護に関する法律（以下「個人情報保護法」といいます。）、電気通信事業法、関連法令、およびガイドラインを遵守し、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます。）を定めます。
      </p>

      <h2>第1条（基本方針・サービスのプライバシー設計）</h2>
      <p>本サービスは、利用者のプライバシー保護を最優先に設計されています。</p>
      <ol>
        <li><strong>会員登録・ログイン不要</strong>：氏名、住所、電話番号、生年月日、クレジットカード情報等の直接的な個人識別情報の登録を一切要求しません。</li>
        <li><strong>最小限のデータ収集</strong>：利用量の記録（Workers Analytics Engine）には、機能の種類、使用したAIモデル、結果（成功・失敗等）、回数、トークン数、所要時間のみを記録し、ユーザーが入力したチャット本文、プロンプト、検索語、成分表示本文、AIの応答本文は記録しません。</li>
        <li><strong>画像・成分表示の非保持原則</strong>：成分表示のOCR（文字認識）のために送信されたパッケージ画像、ユーザーが入力・撮影した成分表示、およびその文字起こし結果は、画面上での確認・一時処理のみに使用し、サーバーおよびデータベースに保存しません。</li>
      </ol>

      <h2>第2条（取得する情報および取得方法）</h2>
      <p>当方は、本サービスの提供にあたり、以下の情報を取得・生成する場合があります。</p>
      <ol>
        <li>
          <strong>アクセスログおよびネットワーク情報（自動取得）</strong>
          <ul>
            <li>接続元のIPアドレス（IPv4、IPv6）</li>
            <li>アクセス元の自律システム番号（ASN、ホスティング事業者情報）</li>
            <li>リクエストヘッダー（User-Agent、Referer、Sec-Fetch-Site、Origin、Accept-Language等）</li>
            <li>アクセス日時、HTTPステータスコード、レスポンスタイム</li>
          </ul>
        </li>
        <li>
          <strong>セッション識別情報（Cookieを通じて自動取得）</strong>
          <ul>
            <li>セッション識別子、有効期限、HMAC暗号署名を含むCookie（名称：<code>__Host-session</code>）</li>
            <li>ボット対策（Cloudflare Turnstile認証）の検証および1日あたりのAPI濫用防止（Spend Cap）のみに使用され、氏名やメールアドレス等の個人属性は一切含まれません（有効期間：24時間）。</li>
          </ul>
        </li>
        <li>
          <strong>ユーザーが入力・送信する情報</strong>
          <ul>
            <li>化粧品名、ブランド名、JAN/EAN/UPCバーコード番号</li>
            <li>成分表示のテキストデータ</li>
            <li>成分表示のパッケージ画像データ（OCR処理のための一時的送信）</li>
            <li>チャット対話形式の問い合わせ文</li>
          </ul>
        </li>
        <li>
          <strong>端末ローカルに保存される情報（ブラウザ内完結）</strong>
          <ul>
            <li>ユーザーの端末のローカルストレージ（<code>localStorage</code>）に保存される「今使っているコスメ」のリスト（キー名：<code>cosmetantei:current-use:v1</code>）</li>
            <li>利用規約・本ポリシー（Cookieの使用を含みます。）に同意したこと、および同意した規約の版（キー名：<code>cosmetantei:consent:v1</code>）</li>
            <li>これらのデータはユーザーのブラウザ内にのみ保存され、当方のサーバーに保管されることはありません。「肌荒れしたコスメ」「普段使えているコスメ」のリストは、ページを開いている間だけ保持され、端末にもサーバーにも保存されません。</li>
          </ul>
        </li>
        <li>
          <strong>画像生成・共有機能における情報（ブラウザ内完結）</strong>
          <ul>
            <li>マイルーティン共有画像（PNG）の生成およびQRコード生成処理は、ユーザーのブラウザ上（HTML5 Canvas）で完結して行われます。画像生成元のルーティンデータが当方のサーバーに送信・蓄積されることはありません。</li>
          </ul>
        </li>
        <li>
          <strong>公開されている製品情報の一時保存（キャッシュ）</strong>
          <ul>
            <li>検索・バーコード照合・Web調査で見つかった市販製品の公開情報（商品名、ブランド名、全成分表示、出典のページのアドレス等）、および成分の解説文は、応答を速くし外部APIの利用を減らすため、Cloudflare KV に一定期間（最長30日）保存し、ほかの利用者への表示にも使用します。</li>
            <li>同じ理由で、入力に対する判定結果（入力の種類、検索結果の絞り込み、ブランド名の確認等）、検索結果、およびチャットの質問に対するAIの応答文を、Cloudflare KV に短期間（30分〜1日。ブランド名の確認結果は最長90日）保存し、同じ入力に対する応答に使用します。</li>
            <li>これらの保存の際、検索語やチャット本文そのものは保存せず、保存の識別には入力内容から計算した復元できない値（SHA-256 ハッシュ値）を使用します。ユーザーが入力・撮影した成分表示やパッケージ画像は、これらの保存の対象になりません。</li>
          </ul>
        </li>
      </ol>

      <h2>第3条（利用目的）</h2>
      <p>当方は、取得した利用者情報を以下の目的のためにのみ利用します。</p>
      <ol>
        <li>化粧品の成分差分照合、成分解説、および代替商品候補の検索・提示のため</li>
        <li>画像認識AIを用いた成分表示の文字起こし処理のため（処理完了後即時破棄）</li>
        <li>不正アクセス、サイバー攻撃、プロンプトインジェクション、不正な自動化アクセス（ボット）、および外部APIの利用予算超過を防止するため（Cloudflare Turnstile、Spend Capによるレート制限・予算制御）</li>
        <li>外部API（Google Gemini、Cloudflare Workers AI、Web検索API、商品検索API等）の呼び出しコストおよび利用頻度の集計・管理のため</li>
        <li>ユーザーからの不具合報告、お問い合わせへの対応のため</li>
        <li>アフィリエイトリンクおよび商品販売ページの適切な表示・遷移のため</li>
        <li>本サービスの品質改善、システム障害の解析、および統計的な利用状況分析のため</li>
      </ol>

      <h2>第4条（安全管理措置）</h2>
      <p>当方は、取り扱う情報の漏えい、滅失または毀損の防止その他の安全管理のため、個人情報保護法および関連ガイドラインに準拠し、以下の技術的・組織的安全管理措置を講じています。</p>
      <ol>
        <li><strong>暗号化通信の徹底</strong>：本サイトへのすべてのアクセスおよびAPI通信には、常時SSL/TLS（HTTPS）による暗号化を適用し、HSTS（HTTP Strict Transport Security）を有効化しています。</li>
        <li><strong>セッションCookieの保護</strong>：セッションCookieには <code>__Host-</code> プレフィックスを付与し、<code>Secure</code>、<code>HttpOnly</code>、<code>SameSite=Strict</code> を指定して、クロスサイトスクリプティング（XSS）および中間者攻撃による不正窃取を防止しています。</li>
        <li><strong>APIキーおよびシークレットの秘匿化</strong>：外部APIトークン（Gemini、Cloudflare、楽天、Yahoo!等）は、Cloudflare AI Gatewayおよび環境変数シークレット（Wrangler Secrets）内で厳重に管理し、クライアント端末やフロントエンドのコードに露出させません。</li>
        <li><strong>一時データの非保存徹底</strong>：OCR用画像データ、ユーザーが入力した成分表示、プロンプト本文、および検索語・チャット本文そのものは、サーバーのメモリ上での一時的処理に留め、永続ストレージ（KV、Durable Objects、ログデータベース等）には書き込みません（第2条第6号に記載の、ハッシュ値を識別に用いた判定結果・応答文の一時保存を除きます）。AI Gateway でも、プロンプトおよび応答の本文をログに残さない設定にしています。</li>
        <li><strong>アクセス制限とレートリミット</strong>：IPアドレスおよびセッション単位でのレートリミッター（Workers Rate Limiting）および全体予算キャップ（Durable Object）を配備し、データ濫用とサービス障害を遮断しています。</li>
      </ol>

      <h2>第5条（第三者提供・外部APIおよびクラウド事業者へのデータ送信）</h2>
      <p>当方は、本サービスの基盤運用および機能提供のため、以下の第三者のクラウドサービス、API、およびアフィリエイトサービスを利用しています。これに伴い、必要最小限のデータ（IPアドレス、検索語、成分文字列、OCR画像等）が各事業者のサーバーへ送信・処理されます。</p>
      <LegalTable>
        <thead>
          <tr>
            <th>サービス名 / 事業者名</th>
            <th>本社所在地</th>
            <th>提供・送信される情報の内容</th>
            <th>利用目的</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Cloudflare</strong>（Cloudflare, Inc.）</td>
            <td>米国</td>
            <td>IPアドレス、アクセスログ、リクエストヘッダー、Turnstile検証データ、チャットの入力文・検索語（Workers AI による判定のため）</td>
            <td>エッジサーバー配信、ボット防御（Turnstile）、入力内容の種類の判定・検索結果の絞り込み（Workers AI）、キャッシュ（KV）、予算制御（Durable Object）</td>
          </tr>
          <tr>
            <td><strong>Google Gemini API</strong>（Google LLC）</td>
            <td>米国</td>
            <td>成分表示画像（OCR用）、商品名、成分文字列、チャットの質問文</td>
            <td>パッケージ画像の文字起こし、成分解説の生成、チャット応答の生成</td>
          </tr>
          <tr>
            <td><strong>Open Beauty Facts</strong>（Open Food Facts）</td>
            <td>フランス</td>
            <td>バーコード（JAN/UPC）番号、検索欄・チャットに入力された商品名</td>
            <td>オープンコスメデータベースからの成分・製品情報の取得</td>
          </tr>
          <tr>
            <td><strong>Exa API</strong>（Exa Labs Inc.）</td>
            <td>米国</td>
            <td>機械的に生成された商品名・バーコード検索クエリ（チャット本文は送信しません）</td>
            <td>商品公式ページ・成分掲載ページのWeb検索</td>
          </tr>
          <tr>
            <td><strong>Linkup API</strong>（Linkup SAS）</td>
            <td>フランス</td>
            <td>機械的に生成された商品名・バーコード検索クエリ（チャット本文は送信しません）</td>
            <td>商品公式ページ・成分掲載ページのWeb検索（フォールバック）</td>
          </tr>
          <tr>
            <td><strong>楽天市場 Web Service</strong>（楽天グループ株式会社）</td>
            <td>日本</td>
            <td>検索のために取り出した語（ブランド名、商品の種類、JANコード等。チャット本文は送信しません）</td>
            <td>楽天市場における商品情報、価格情報、ラインナップの取得</td>
          </tr>
          <tr>
            <td><strong>Yahoo!ショッピング Web API</strong>（LINEヤフー株式会社）</td>
            <td>日本</td>
            <td>検索のために取り出した語（ブランド名、商品の種類、JANコード等。チャット本文は送信しません）</td>
            <td>Yahoo!ショッピングにおける商品情報、価格情報、JANコード照合</td>
          </tr>
          <tr>
            <td><strong>Amazon アソシエイト</strong>（アマゾンジャパン合同会社 / Amazon.com Services LLC）</td>
            <td>日本 / 米国</td>
            <td>リンクを開いた際の、リンクに含まれる商品名・JANコード等の検索語</td>
            <td>商品詳細ページおよび価格確認リンクの提供</td>
          </tr>
          <tr>
            <td><strong>バリューコマース</strong>（バリューコマース株式会社）</td>
            <td>日本</td>
            <td>提携リンク経由のアクセス情報、クリック識別子</td>
            <td>Yahoo!ショッピング等のアフィリエイトリンクの配信および成果計測</td>
          </tr>
        </tbody>
      </LegalTable>
      <p className="text-sm">※Google Gemini API は有料プランで利用しており、Google の規約に基づき、送信したデータはモデルの学習には利用されません。</p>

      <h2>第6条（外国にある第三者への移転に関する情報提供・法第28条対応）</h2>
      <p>本サービスが利用する外部事業者のうち、一部のサーバーおよび事業者は日本国外に所在しています。</p>
      <ol>
        <li><strong>提供先の所在国</strong>：アメリカ合衆国（Cloudflare, Inc.、Google LLC、Exa Labs Inc.、Amazon.com Services LLC）、フランス共和国（Linkup SAS、Open Food Facts）</li>
        <li>
          <strong>当該国の個人情報の保護に関する制度</strong>
          <ul>
            <li><strong>アメリカ合衆国</strong>：連邦レベルの包括的な個人情報保護法はなく、分野ごとの連邦法および州法（カリフォルニア州消費者プライバシー法等）により規律されています。</li>
            <li><strong>フランス共和国</strong>：欧州連合（EU）の一般データ保護規則（GDPR）が適用されており、個人情報保護委員会により、個人の権利利益を保護する上で日本と同等の水準にあると認められる個人情報の保護に関する制度を有している国として指定されています。</li>
            <li>各国の制度については、個人情報保護委員会「<ExternalLink href="https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku">外国における個人情報の保護に関する制度等の調査</ExternalLink>」もご参照ください。</li>
          </ul>
        </li>
        <li><strong>当該事業者が講ずる措置</strong>：各事業者は、それぞれが公表するプライバシーポリシーおよびデータ処理に関する条件に基づき、送信された情報を取り扱っています。</li>
      </ol>

      <h2>第7条（電気通信事業法に基づく「外部送信規律」に関する表記）</h2>
      <p>
        本サイトは、電気通信事業法第27条の12（外部送信規律／情報送信指令通信に関する規律）および同法施行規則第22条の2の27以下の規定、ならびに総務省「外部送信規律FAQ」等に基づき、利用者の端末から外部のサーバーへ送信される利用者に関する情報（以下「外部送信情報」といいます。）について、以下のとおり公表します。
      </p>

      <h3>1. 通信形態の区分および適用除外の明示</h3>
      <p>本サイトにおいて発生するデータ通信は、以下の3種類に区分されます。</p>
      <ol>
        <li><strong>外部送信規律の対象となる情報送信</strong>：本サイトに掲載したアフィリエイトリンク等を通じて、利用者の端末から直接、提携事業者のサーバーへ情報が送信される通信です（下記「2.」に記載）。</li>
        <li><strong>適用除外に該当する情報送信</strong>：サービスの提供のために必要な情報（セキュリティ・ボット対策、セッション管理、ページに表示する商品画像の取得等）の送信です。法令上の公表義務の対象外ですが、透明性向上の観点から、その内容を下記「3.」において公表しています。</li>
        <li><strong>サーバー間通信</strong>：利用者の端末から直接送信されるのではなく、当方のサーバー（Cloudflare Workers）から外部API事業者（Google Gemini、Exa、Linkup、Open Beauty Facts、楽天、LINEヤフー等）へ送信される通信です。外部送信規律の対象外ですが、本ポリシー第5条および第6条において開示しています。</li>
      </ol>

      <h3>2. 外部送信規律に基づく公表事項（アフィリエイトプログラム）</h3>
      <p>
        本サイトでは、利用者が販売ページへのリンクを開いた際に、以下の情報が送信先へ送信されます。なお、本サイトの販売ページへのリンクは、遷移元のページのアドレス（Referer）をブラウザが送信しない設定（<code>{'rel="noreferrer"'}</code>）にしています。
      </p>
      <LegalTable>
        <thead>
          <tr>
            <th>送信先（事業者名・サービス名）</th>
            <th>送信される利用者情報の内容</th>
            <th>当方における利用目的</th>
            <th>送信先における利用目的（概要）およびプライバシーポリシー</th>
            <th>オプトアウト（追跡拒否）手段</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>アマゾンジャパン合同会社 / Amazon.com Services LLC</strong>（Amazonアソシエイト・プログラム）</td>
            <td>クリック日時、閲覧端末の識別情報（Cookie等）、アソシエイトの識別タグ（<code>tag=cosmetantei22-22</code>）</td>
            <td>適切な商品購入ページへの誘導、および適格販売に伴う紹介料の計測・算定のため</td>
            <td>
              商品の購入実績および広告成果の追跡・認証、不正クリックの検知、自社サービスの改善および広告の配信のために利用されます。
              <br />
              <ExternalLink href="https://www.amazon.co.jp/-/en/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ">Amazon.co.jp プライバシー規約</ExternalLink>
            </td>
            <td><ExternalLink href="https://www.amazon.co.jp/adprefs">Amazon.co.jp 広告設定</ExternalLink>から設定できます。</td>
          </tr>
          <tr>
            <td><strong>楽天グループ株式会社</strong>（楽天アフィリエイト）</td>
            <td>クリック日時、ブラウザ識別用Cookie、楽天アフィリエイトの識別子</td>
            <td>楽天市場の商品の詳細ページの提示、およびアフィリエイト報酬の計測・算定のため</td>
            <td>
              広告成果の計測、不正防止、マーケティング分析、および広告の配信のために利用されます。
              <br />
              <ExternalLink href="https://privacy.rakuten.co.jp/">楽天グループ 個人情報保護方針</ExternalLink>
            </td>
            <td><ExternalLink href="https://privacy.rakuten.co.jp/">楽天グループ 個人情報保護方針</ExternalLink>に記載の方法で設定できます。</td>
          </tr>
          <tr>
            <td><strong>バリューコマース株式会社</strong>（Yahoo!ショッピングへのリンク）</td>
            <td>クリック日時、クリック識別コード、端末識別用Cookie</td>
            <td>Yahoo!ショッピングにおける販売ページの提示、および成果報酬の計測・算定のため</td>
            <td>
              アフィリエイト広告の成果測定、不正利用・多重クリックの防止、広告配信システムの最適化、および統計的分析のために利用されます。
              <br />
              <ExternalLink href="https://www.valuecommerce.co.jp/privacy_policy/">バリューコマース プライバシーポリシー</ExternalLink>
            </td>
            <td><ExternalLink href="https://www.valuecommerce.co.jp/privacy_policy/privacy_action/">バリューコマース 個人情報の取扱い</ExternalLink>から無効化できます。</td>
          </tr>
        </tbody>
      </LegalTable>

      <h3>3. 適用除外となる送信（セキュリティ・セッション管理・商品画像の表示）</h3>
      <ol>
        <li>
          <strong>ボット排除・セキュリティ検証（Cloudflare Turnstile）</strong>
          <ul>
            <li>送信先：Cloudflare, Inc.（米国）</li>
            <li>送信情報：接続元IPアドレス、ブラウザの描画・表示環境に関する情報、画面の操作に関する情報、HTTPヘッダー</li>
            <li>利用目的：悪意のあるボット、自動化攻撃、スクレイピングおよび外部APIの不正利用を検知・排除し、サービスの安定提供を維持するため</li>
            <li>プライバシーポリシー：<ExternalLink href="https://www.cloudflare.com/privacypolicy/">Cloudflare Privacy Policy</ExternalLink></li>
          </ul>
        </li>
        <li>
          <strong>ファーストパーティ・セッションCookie（<code>__Host-session</code>）</strong>
          <ul>
            <li>送信先：当方のサーバー（https://cosmetantei.app）</li>
            <li>送信情報：署名付きのセッションID、発行・有効期限情報（有効期間24時間）</li>
            <li>利用目的：Turnstileの認証状態を一時的に保持し、1日あたりのAPI利用上限（Spend Cap）を管理するため（外部の事業者へは送信されません）</li>
          </ul>
        </li>
        <li>
          <strong>商品画像の表示</strong>
          <ul>
            <li>送信先：商品画像を配信する事業者のサーバー（楽天グループ株式会社、LINEヤフー株式会社、Open Food Facts）</li>
            <li>送信情報：接続元IPアドレス、ブラウザの種類（User-Agent）、表示する画像のアドレス</li>
            <li>利用目的：検索結果・商品候補に商品の写真を表示するため</li>
          </ul>
        </li>
      </ol>

      <h3>4. 容易に知り得る状態の確保（公表方法）</h3>
      <p>当方は、本サイトのトップ画面から1回の操作で到達できる位置に「プライバシーポリシー」へのリンクを常時配置し、利用者が内容を確認できる環境を確保しています。</p>

      <h2>第8条（Cookieおよびローカルストレージの取扱い）</h2>
      <ol>
        <li>
          <strong>Cookie（クッキー）の利用</strong>：本サービスは、初めてご利用いただく際に表示する確認画面で、利用規約および本ポリシー（Cookieの使用を含みます。）への同意をいただいてから利用を開始します。同意をいただく前は、ボット対策（Cloudflare Turnstile）を読み込まず、Cookieも発行しません。本サービスでは、セキュリティ認証およびレート制限のため、ファーストパーティCookie（<code>__Host-session</code>）を使用しています。このCookieは、ブラウザを再読み込みした際の一時的認証状態の維持に使用され、第三者企業による行動ターゲティング広告等には利用されません。
          ユーザーは、ブラウザの設定によりCookieの受け入れを拒否することができますが、その場合、ボット対策チェックを通過できず、AI機能等の本サービスの一部が利用できなくなることがあります。
        </li>
        <li>
          <strong>ローカルストレージ（localStorage）の利用</strong>：本サービスは、ユーザーが登録した「今使っているコスメ」のリストを端末内に保持するため、ブラウザのローカルストレージ機能を利用しています。このデータは、ブラウザのサイトデータの削除によりいつでもユーザー自身で消去することができます。
        </li>
      </ol>

      <h2>第9条（開示・訂正・利用停止等の請求手続き）</h2>
      <ol>
        <li>当方は、本サービスにおいて氏名、住所、メールアドレス等を含む個人情報を収集・保持しておりません。そのため、特定の個人を識別できる保有個人データが存在しない場合、個人情報保護法に基づく開示・訂正・利用停止等の請求に対応できない場合があります。</li>
        <li>セッションCookie、アクセスログ等に関してご質問・ご要望がある場合は、第11条のお問い合わせ窓口までご連絡ください。法令の定めに従って誠実に対応いたします。</li>
      </ol>

      <h2>第10条（プライバシーポリシーの改定）</h2>
      <p>当方は、法令の改正、公的ガイドラインの改定、サービス内容の拡充、またはセキュリティ要件の変更等に伴い、本ポリシーを適宜見直し、改定することがあります。改定後のプライバシーポリシーは、本サイト上に掲示した時点から効力を生じるものとします。</p>

      <h2>第11条（お問い合わせ窓口）</h2>
      <p>本ポリシーまたは利用者情報の取扱いに関するご意見、ご質問、苦情のお申し出は、以下の窓口まで電子メールにてご連絡ください。</p>
      <p>
        サービス名：コスメ探偵（CosmeTantei）
        <br />
        運営者：コスメ探偵 運営事務局
        <br />
        連絡先メールアドレス：<a href="mailto:contact@cosmetantei.app">contact@cosmetantei.app</a>
        <br />
        受付時間：メールは常時受け付けています（返信は原則として平日に行います）
      </p>
    </LegalPage>
  );
}
