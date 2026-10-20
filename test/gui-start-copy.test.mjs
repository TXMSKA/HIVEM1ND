import assert from'node:assert/strict';import test from'node:test';import{AGENT_ROLES,START_COPY,roleHint,roleLabel,startText}from'../gui/app/start-copy.mjs';import{assertVisibleCopy}from'./spanish-register.test.mjs';
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
test('every role of the picker has a label and a one-line description in both languages, and an unknown role reads as an agent',()=>{
  const labels={en:['Executor','Overlord','UX designer','UI designer','Writer','Game designer','Security consultant','QA','Code reviewer','Product manager','Helper','Custom'],
    es:['Executor','Overlord','Diseñador UX','Diseñador UI','Redactor','Game designer','Consultor de ciberseguridad','QA','Revisor de código','Product manager','Ayudante','Personalizado']};
  for(const language of['en','es']){
    assert.deepEqual(AGENT_ROLES.map(role=>roleLabel(language,role)),labels[language]);
    for(const role of AGENT_ROLES){const hint=roleHint(language,role);assert.ok(hint.length>12&&!hint.includes('\n'),role);}
  }
  assert.equal(roleLabel('en','custom','Release captain'),'Release captain');assert.equal(roleLabel('es','custom'),'Personalizado');
  for(const role of['nothing-known','constructor',null,undefined,42])assert.equal(roleLabel('en',role),'Agent',String(role));
  assert.equal(roleLabel('en','overseer'),'Overseer');assert.equal(roleLabel('es','genesis'),'Genesis');
  // The role copy, the Custom fields and their messages pass the same register check as the rest of the Spanish copy.
  const keys=Object.keys(START_COPY);const from=keys.indexOf('role');
  assertVisibleCopy('es',keys.slice(from).map(key=>[`START_COPY.es.${key}`,START_COPY[key][1]]));
  assertVisibleCopy('en',keys.slice(from).map(key=>[`START_COPY.en.${key}`,START_COPY[key][0]]));
});
