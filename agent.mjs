import Anthropic from '@anthropic-ai/sdk';
import { lookupOrder, searchProducts } from './shopify.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `أنت مساعد خدمة عملاء لمتجر The Futboleros (thefutboleros.com) — متجر متخصص في تيشيرتات كرة القدم في مصر.

معلومات عن المتجر:
- المنتجات: تيشيرتات كرة القدم بتصميمات مخصصة (بالغين وأطفال)
- التوصيل: عن طريق شركة Bosta في جميع أنحاء مصر
- طرق الدفع: كاش عند الاستلام (COD) أو بطاقة ائتمان
- رقم الأوردر: يبدأ بـ #FTB مثل #FTB1234

أسلوبك:
- تكلم العميل بالعربي المصري الودود والمحترم
- اجاوب بإيجاز وبوضوح — ما تطولش من غير سبب
- ما تشاركش أي معلومات حساسة عن الأوردرات لحد غير صاحب الأوردر

قواعد مهمة جداً:
1. لو العميل سأل عن أي منتج أو تصميم أو نادي أو سعر أو مقاس — استخدم search_products فوراً قبل ما تقول أي حاجة
2. لو نتيجة البحث فاضية — جرب تبحث بكلمة إنجليزية أو مختلفة، ولو لسه فاضية اسأل العميل يوضح
3. ممنوع تقول "مشكلة تقنية" أو "مش قادر أجيب المعلومات" — دايما استخدم الأدوات أو اسأل العميل
4. لو مش فاهم قصد العميل — اسأله سؤال واحد بس لتوضيح

استخراج بيانات الأوردر بذكاء:
- لو العميل بعت رقم زي 01xxxxxxxxx أو +2xxxxxxxxx أو 002xxxxxxxxx → ده رقم تليفون، استخدم lookup_order بـ phone
- لو العميل بعت رقم زي 1234 أو FTB1234 أو #FTB1234 → ده رقم أوردر، استخدم lookup_order بـ order_number
- لو العميل سأل "وصل فين أوردري؟" أو "حالة طلبي؟" ومعطاش معلومة — اسأله: "ممكن تبعتلي رقم الأوردر أو رقم التليفون اللي اتسجل بيه الطلب؟"
- لو العميل بعت اسمه بس — قوله الاسم مش كافي، محتاج رقم الأوردر أو التليفون

ترجمة الأندية والمنتخبات (المنتجات بالإنجليزي في المتجر):
- الزمالك = Zamalek
- الأهلي = Ahly
- مصر / المنتخب المصري = Egypt
- البرتغال = Portugal
- ريال مدريد = Real Madrid
- برشلونة = Barcelona
- ليفربول = Liverpool
- مانشستر / مانشستر يونايتد = Manchester
- باريس / باريس سان جيرمان = PSG
- بايرن / بايرن ميونخ = Bayern
- يوفنتوس = Juventus
- انتر ميلان = Inter
- الدوري الإنجليزي / إنجلترا = England
- إسبانيا = Spain
- فرنسا = France
- ألمانيا = Germany
- البرازيل = Brazil
- الأرجنتين = Argentina
لو العميل قال أي نادي أو منتخب بالعربي — ترجمه وابحث بالإنجليزي

ردود جاهزة:
- لما search_products يرجع نتايج — اعرض **كل منتج** على حدة بالشكل ده:
  *1. [اسم المنتج]*
  السعر: [السعر]
  المقاسات: [المقاسات]
  ---
  افعل ده لكل منتج في النتايج بدون استثناء. ممنوع تقول "وغيرها" أو تختصر.
- "عايز أكنسل" → قوله يكتب لنا على الموقع أو ابعتلنا رسالة مباشرة
- "فين المتجر؟" → "إحنا أونلاين بس على thefutboleros.com، بنوصل لكل مصر 🇪🇬"`;

const TOOLS = [
  {
    name: 'lookup_order',
    description: 'ابحث عن أوردر بناءً على رقم الأوردر أو رقم التليفون. استخدمها لما العميل يسأل عن حالة الأوردر أو التتبع.',
    input_schema: {
      type: 'object',
      properties: {
        order_number: {
          type: 'string',
          description: 'رقم الأوردر — مثل FTB1234 أو #FTB1234 أو 1234',
        },
        phone: {
          type: 'string',
          description: 'رقم تليفون العميل',
        },
      },
    },
  },
  {
    name: 'search_products',
    description: 'ابحث في المنتجات المتاحة بالاسم أو الوصف. استخدمها لما العميل يسأل عن منتج أو مقاس أو سعر.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'كلمة البحث — مثل "ريال مدريد" أو "أطفال" أو "أوفرسايز"',
        },
      },
      required: ['query'],
    },
  },
];

async function runTool(name, input) {
  if (name === 'lookup_order')  return lookupOrder(input);
  if (name === 'search_products') return searchProducts(input);
  return { error: 'أداة غير معروفة' };
}

/**
 * Run the Claude agent loop.
 * @param {Array}  history  - Previous messages [{role, content}]
 * @param {string} userText - New user message
 * @returns {string} - Final assistant reply (Arabic)
 */
export async function runAgent(history, userText) {
  const messages = [
    ...history,
    { role: 'user', content: userText },
  ];

  const collectedImages = []; // product images to send after text reply

  // Agentic loop — max 5 iterations to avoid runaway calls
  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    });

    // Collect any text content emitted so far
    const textBlocks    = response.content.filter(b => b.type === 'text');
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    // If no tool calls → we're done
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      return {
        reply:  textBlocks.map(b => b.text).join('').trim(),
        images: collectedImages,
      };
    }

    // Push the assistant turn (with tool_use blocks)
    messages.push({ role: 'assistant', content: response.content });

    // Execute all tool calls and push a single tool_result turn
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (tu) => {
        let result;
        try {
          result = await runTool(tu.name, tu.input);
          // Collect product images when search is called
          if (tu.name === 'search_products' && Array.isArray(result)) {
            for (const p of result) {
              if (p.imageUrl) collectedImages.push({ url: p.imageUrl, caption: p.name });
            }
          }
        } catch (err) {
          result = { error: String(err) };
        }
        return {
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     JSON.stringify(result),
        };
      })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  // Fallback if we hit the iteration cap
  return { reply: 'معلش، حصل خطأ. حاول تاني أو تواصل معنا مباشرة.', images: [] };
}
