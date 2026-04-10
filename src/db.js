const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function addItem(phone, item) {
  const { error } = await supabase
    .from('shopping')
    .insert({ phone, item });
  if (error) throw error;
}

async function listItems(phone) {
  const { data, error } = await supabase
    .from('shopping')
    .select('item')
    .eq('phone', phone)
    .eq('done', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(row => row.item);
}

async function markDone(phone, item) {
  const { error } = await supabase
    .from('shopping')
    .update({ done: true })
    .eq('phone', phone)
    .ilike('item', `%${item}%`);
  if (error) throw error;
}

async function getHistory(phone) {
  const { data, error } = await supabase
    .from('conversations')
    .select('history')
    .eq('phone', phone)
    .single();
  if (error || !data) return [];
  return data.history || [];
}

async function saveHistory(phone, history) {
  const { error } = await supabase
    .from('conversations')
    .upsert({ phone, history, updated_at: new Date().toISOString() });
  if (error) throw error;
}

module.exports = { addItem, listItems, markDone, getHistory, saveHistory };
