// Actual server-rendered recovery controls, synthetic private filesystem only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MASCOT_PLAYWRIGHT||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.argv[2],temp=fs.mkdtempSync(path.join(os.tmpdir(),'mascot-recovery-ui-'));
for(const name of ['public','public/uploads','public/uploads/wzf-mascot','private'])fs.mkdirSync(path.join(temp,name),{mode:0o700});
if(out)fs.mkdirSync(out,{recursive:true});
const php=`define('ABSPATH',${JSON.stringify(temp+'/public/')});define('WZF_MASCOT_RECOVERY_DIR',${JSON.stringify(temp+'/private')});
function __($s,$d=null){return $s;}function esc_html__($s,$d=null){return htmlspecialchars($s,ENT_QUOTES);}function esc_attr__($s,$d=null){return htmlspecialchars($s,ENT_QUOTES);}
function esc_attr($s){return htmlspecialchars((string)$s,ENT_QUOTES);}function esc_html($s){return esc_attr($s);}function esc_url($s){return esc_attr($s);}
function add_action(...$a){}function add_filter(...$a){}function plugin_basename($s){return $s;}function get_current_blog_id(){return 1;}function wp_salt($s){return 'synthetic-only';}
function wp_upload_dir(...$a){return ['basedir'=>${JSON.stringify(temp+'/public/uploads')},'baseurl'=>'/uploads'];}function admin_url($s){return '/'.$s;}
function wp_nonce_field($s){echo '<input type="hidden" name="_wpnonce" value="synthetic">';}function wp_json_encode($v){return json_encode($v);}function size_format($v){return $v.' B';}
function submit_button($text,$class='primary',$name='submit',$wrap=true){echo '<p><button type="submit" class="button '.($class==='primary'?'button-primary':'').'"'.($name!==''?' name="'.$name.'"':'').'>'.esc_html($text).'</button></p>';}
require ${JSON.stringify(repo+'/plugin/includes/admin-import.php')};
$dir=wzf_mascot_recovery_blog(true).'/'.str_repeat('a',32);mkdir($dir,0700);
wzf_mascot_recovery_write($dir,['schema'=>1,'blog'=>1,'id'=>str_repeat('a',32),'name'=>'model-'.str_repeat('b',32),'state'=>'quarantined','tree'=>['bytes'=>200]]);
$config=['characters'=>[]];$GLOBALS['wzf_mascot_recovery_review']=['plan'=>['name'=>'model-'.str_repeat('b',32),'operation'=>'quarantine','bytes'=>200],'signature'=>'synthetic'];
wzf_mascot_recovery_panel($config);`;
(async()=>{let browser;try{
 const html=execFileSync('php',['-r',php],{encoding:'utf8'});browser=await chromium.launch({executablePath:process.env.MASCOT_CHROMIUM});const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px;background:#f6f7f7;font:14px/1.5 system-ui,sans-serif}'+fs.readFileSync(path.join(repo,'plugin/admin.css'),'utf8')+'</style><main class="wzf-mascot-admin">'+html+'</main>');
 const move=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Move one unreferenced resource root'})}).first();await move.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await move.getAttribute('open'),'');
 const input=move.locator('[name="path"]');await input.fill('not-managed');assert.equal(await input.evaluate(el=>el.checkValidity()),false);await input.fill('model-'+'b'.repeat(32));assert.equal(await input.evaluate(el=>el.checkValidity()),true);
 assert.equal(await move.locator('[name="days"]').inputValue(),'30');const danger=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Permanent deletion'})}).last();assert.equal(await danger.getAttribute('open'),null);
 const confirmation=page.locator('.wzf-mascot-recovery-confirm');assert.equal(await confirmation.locator('form').evaluate(el=>el.checkValidity()),false);await confirmation.locator('[name="confirm"]').check();assert.equal(await confirmation.locator('form').evaluate(el=>el.checkValidity()),true);
 assert.equal(await page.locator('button[name="submit"]').count(),0);if(out)await page.screenshot({path:path.join(out,'recovery-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(out)await page.screenshot({path:path.join(out,'recovery-mobile.png'),fullPage:true});
 await danger.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await danger.getAttribute('open'),'');console.log(JSON.stringify({complete:true,checks:5,syntheticOnly:true}));
 }finally{if(browser)await browser.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
