const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  (process.env.SUPABASE_URL || '').split(/\s/)[0],
  (process.env.SUPABASE_ANON_KEY || '').split(/\s/)[0]
);

// ---------- Family / member resolution ----------

async function getMember(phone) {
  const { data } = await supabase
    .from('members')
    .select('phone, family_id, member_name')
    .eq('phone', phone)
    .maybeSingle();
  return data || null;
}

async function createFamily(name, phone, memberName) {
  const { data: fam, error: e1 } = await supabase
    .from('families').insert({ name }).select('id').single();
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from('members').insert({ phone, family_id: fam.id, member_name: memberName });
  if (e2) throw e2;
  return fam.id;
}

async function addMember(familyId, phone, memberName) {
  const { error } = await supabase
    .from('members')
    .upsert({ phone, family_id: familyId, member_name: memberName });
  if (error) throw error;
}

// ---------- Facts ----------

async function getFacts(familyId) {
  const { data, error } = await supabase
    .from('facts')
    .select('key, value')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveFact(familyId, key, value) {
  const { error } = await supabase
    .from('facts')
    .upsert({ family_id: familyId, key, value }, { onConflict: 'family_id,key' });
  if (error) throw error;
}

async function deleteFact(familyId, key) {
  const { error } = await supabase
    .from('facts').delete().eq('family_id', familyId).eq('key', key);
  if (error) throw error;
}

// ---------- Shopping list (family-scoped) ----------

async function addItem(familyId, item, addedBy) {
  const { error } = await supabase
    .from('shopping').insert({ family_id: familyId, item, added_by: addedBy });
  if (error) throw error;
}

async function listItems(familyId) {
  const { data, error } = await supabase
    .from('shopping')
    .select('item, added_by')
    .eq('family_id', familyId)
    .eq('done', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function markDone(familyId, item) {
  const { error } = await supabase
    .from('shopping').update({ done: true })
    .eq('family_id', familyId).ilike('item', `%${item}%`);
  if (error) throw error;
}

// ---------- Butcher list (family-scoped) ----------

async function addButcherItem(familyId, item, addedBy) {
  const { error } = await supabase
    .from('butcher').insert({ family_id: familyId, item, added_by: addedBy });
  if (error) throw error;
}

async function listButcherItems(familyId) {
  const { data, error } = await supabase
    .from('butcher')
    .select('item, added_by')
    .eq('family_id', familyId)
    .eq('done', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function markButcherDone(familyId, item) {
  const { error } = await supabase
    .from('butcher').update({ done: true })
    .eq('family_id', familyId).ilike('item', `%${item}%`);
  if (error) throw error;
}

// ---------- History (still per-phone) ----------

async function getHistory(phone) {
  const { data } = await supabase
    .from('conversations').select('history').eq('phone', phone).maybeSingle();
  return data?.history || [];
}

async function saveHistory(phone, history) {
  const { error } = await supabase
    .from('conversations')
    .upsert({ phone, history, updated_at: new Date().toISOString() });
  if (error) throw error;
}

module.exports = {
  getMember, createFamily, addMember,
  getFacts, saveFact, deleteFact,
  addItem, listItems, markDone,
  addButcherItem, listButcherItems, markButcherDone,
  getHistory, saveHistory,
};
