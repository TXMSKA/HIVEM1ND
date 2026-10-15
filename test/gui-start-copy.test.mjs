import assert from'node:assert/strict';import test from'node:test';import{START_COPY,startText}from'../gui/app/start-copy.mjs';
test('every start label is literal bilingual and Spanish actions are impersonal',()=>{
  for(const[key,pair]of Object.entries(START_COPY)){
    assert.equal(pair.length,2,key);assert.ok(pair.every(s=>typeof s==='string'&&s.length>0),key);
    assert.doesNotMatch(pair.join(' '),/\u2014/);assert.doesNotMatch(pair[1],/\b(vos|tu|tus|tenés|podés|elegí|hacé|usá)\b/i);
    assert.equal(startText('en',key),pair[0]);assert.equal(startText('es',key),pair[1]);
  }
});
test('copy values remain text data and task count placeholders are explicit',()=>{
  assert.equal(startText('es','import',{count:26}),'Importar 26');
  assert.equal(startText('en','plan',{title:'<script>fixture</script>'}),'Plan: <script>fixture</script>');
  assert.equal(startText('en','commitsHint',{branch:'cart-empty'}),'Each task is committed on cart-empty');
  assert.throws(()=>startText('en','invented'),/Unknown start copy/);
});
