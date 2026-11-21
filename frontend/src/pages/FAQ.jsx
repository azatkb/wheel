import { useState, useEffect } from 'react'

/* ── FAQ data — from official Lajtner FAQ document ────────── */
const FAQ_SECTIONS = [
  {
    title: 'About the Lajtner Scope',
    items: [
      {
        q: 'What does the Lajtner Scope measure?',
        a: 'In technical terms, it measures your focus: how strong and how precise it is. The Lajtner Scope is not a medical device. It is not intended to diagnose, treat, cure, or prevent any disease or health condition. Focus and thought force are closely linked: the stronger and more precise your focus, the greater the thought force the Lajtner Scope measures.'
      },
      {
        q: 'Is this the same as mind power?',
        a: 'As a general idea, yes. But once we start measuring, we are using physics, and in physics, force and power are different quantities. What turns the star is called torque, which comes from force (torque = force × lever arm). From the star\'s rotation, we can also calculate power (in watts) and energy (in joules). That is why "thought force" is a more accurate term than "mind power."'
      },
      {
        q: 'Is the Lajtner Scope a wheel?',
        a: 'We call the rotor the star. You can call it whatever you like. What matters is that the Lajtner Code app detects its rotation.'
      },
      {
        q: 'Why is the Lajtner Scope this size?',
        a: 'We arrived at its size and shape by testing many different stars over years of research. We also made the star light but denser than water, so that it sinks. This makes the Lajtner Scope "amphibious": it works in both water and air. Another key goal in choosing the size was that, as far as possible, everyone should be able to rotate the star with their thought force.'
      },
      {
        q: 'Why is it this shape?',
        a: 'Because after many experiments, this shape proved to be the best. We developed many rotors in other shapes, both centrally symmetric and asymmetric, but none matched the practical value of the current version.'
      },
      {
        q: 'Does it only work in air?',
        a: 'No. As mentioned above, the Lajtner Scope works in both water and air. The hardware video that comes with the Lajtner Scope shows you how to switch it to underwater mode. Please note: the Lajtner Scope has a sharp, pointed part. Always cover it with the protective cap when you handle the device, especially when you switch between air mode and water mode. A separate warning label supplied with the Lajtner Scope also draws your attention to this.'
      }
    ]
  },
  {
    title: 'Thought Force & How It Works',
    items: [
      {
        q: 'It\'s the wind that turns the star, not thought force.',
        a: 'You can turn the star by hand, with air, or in other ways. If you switch off the air conditioner and the fan, and there is no draft in the room, the star stays still. Then, if you can send a thought in the right way and with enough force, your thought will turn it. Your body heat and breathing also move the air slightly, which is why we recommend keeping some distance from the device. If you want to rule out air movement completely, use the underwater mode.'
      },
      {
        q: 'Why don\'t you filter out the effect of moving air?',
        a: 'We do have a model that measures air movement with an electronic anemometer, but it is not currently available for purchase. For the Kinetic Model 1.0, our goal was to keep it as simple as possible. The underwater mode is the simplest way to rule out air movement.'
      },
      {
        q: 'I don\'t believe that thoughts have force.',
        a: 'You don\'t have to believe it. The proof of the pudding is in the eating, and the proof of thought force is the Lajtner Scope. If it turns when there is no air movement, for example in underwater mode, it turns.'
      },
      {
        q: 'It doesn\'t turn for me. Is it broken?',
        a: 'We ran a great many experiments to find a rotor with the right weight and the right suspension. Based on our experience so far, almost everyone succeeds with practice. It takes time. Give your thought force time to grow strong enough to start the star turning. If it doesn\'t work at first, that is completely normal, and it doesn\'t mean that anything is wrong with you.'
      },
      {
        q: 'How do I need to think to send force with my thoughts?',
        a: 'Every Lajtner Scope comes with three videos: one about L-Thinking by Lajtner, one about the hardware, and one about the app. The L-Thinking by Lajtner video teaches you what to focus on when you want to send force with your thoughts. Some people can do it right away, while others need a few days to get a feel for it. Almost everyone succeeds with practice.'
      },
      {
        q: 'How far does thought force reach?',
        a: 'We don\'t know the full range. In our tests, it worked from at least 1 km (about 0.6 miles) away. In a closed room, thought force has also repeatedly turned the Lajtner Scope from 25 m (about 27 yards) away. This takes practice, though.'
      },
      {
        q: 'What does thought force affect?',
        a: 'We believe it affects everything to some degree; what differs is how large and how noticeable the change is. In our experiments, thought force has moved the inanimate Lajtner Scope, and it has also influenced things like the growth of flowers. There is a separate video about this in our shop.'
      },
      {
        q: 'Is it dangerous to my health?',
        a: 'Based on our research and experience, we are not aware of any harm from the conscious use of thought force, and many people feel better after practicing. However, rotating the star requires a kind of concentration you are not used to. The Lajtner Scope is meant for healthy users. If you have a disease of the brain or nervous system or another serious illness, a condition affecting the eyes, ears or any other part of the head, and/or fluctuating blood pressure, please talk to your doctor before you use the Lajtner Scope, to find out whether you may use it. The Lajtner Scope is not a medical device.'
      },
      {
        q: 'Is L-Thinking by Lajtner tiring?',
        a: 'Yes, it can tire you out. This kind of concentration is new to you, so you will probably get tired. When you do, stop, because practicing while tired only makes you more tired. This is mental fatigue, not physical fatigue, and if you are otherwise healthy, you will usually recover from it quickly.'
      },
      {
        q: 'How much time should I spend practicing?',
        a: 'Practice has two parts. The first is learning to use your thought force consciously. If you spend 3–5 minutes once or twice a day, within a few weeks you will be able to move the star fairly confidently. You don\'t need to turn it all the way around — a turn of 10–20 degrees in a draft-free room is already a good sign. The second part is becoming confident enough to call up this ability at any time, which may take several months.'
      },
      {
        q: 'What does L-Thinking by Lajtner have to do with spirituality?',
        a: 'L-Thinking by Lajtner is not built on any spiritual or religious tradition, and you don\'t need any belief to use it. Some traditions describe similar experiences; what you read into it is up to you. We don\'t deal with mysticism, spirituality, religion or esotericism. Our approach is based on physics and measurement.'
      }
    ]
  },
  {
    title: 'The Science',
    items: [
      {
        q: 'What is Lajtner Resonance?',
        a: 'Lajtner Resonance is both a principle and a measurement result. As a measurement result, it is calculated from the measured energy using Planck\'s formula, expressed as the frequency of a theoretical photon with the same energy. As a principle, it is perhaps the most important part of thought force — like a swing, small pushes at the right rhythm achieve more than big pushes at the wrong one. You can apply as much force as you can muster, but it is useless without the right resonance.'
      },
      {
        q: 'How should I understand the Lajtner Resonance value?',
        a: 'Lajtner Resonance is useful when you compare several values. In the notation, the number before L shows small changes, while the number before R shows very significant changes. If one value is 3.2L+19R and another is 3.6L+19R, the second is a little higher. If one value is 3.2L+19R and another is 2L+21R, thought force had a considerably greater effect.'
      },
      {
        q: 'What is Lajtner Time and the Lajtner Point?',
        a: 'The Lajtner Point is the tipping point at which the influence of thought force becomes observable or measurable. Lajtner Time is the time it takes to reach this point — the time from the start of the video until the star starts to move.'
      },
      {
        q: 'What is Lajtner Jerk?',
        a: 'Lajtner Jerk shows how quickly the star\'s acceleration changes (in physics, this is called jerk: the rate of change of acceleration). It is strongest mainly just after the star starts to move.'
      },
      {
        q: 'How accurate are the measurements?',
        a: 'Precise enough to detect even very small movements. The Lajtner Code uses state-of-the-art computer vision. The results are calculated from these movements using physics formulas and certain other mathematical methods.'
      },
      {
        q: 'Are the values from the Lajtner Scope correct and consistent with physics?',
        a: 'The mechanical values (energy in joules or electronvolts, force in newtons) are calculated with the standard methods of classical mechanics. We simplified these calculations in places (for example, by averaging the braking forces), but they follow those methods in every respect. Lajtner Resonance is calculated from the measured energy of the star.'
      },
      {
        q: 'Does the Lajtner Code include a stochastic model?',
        a: 'Yes. One of the menu items leads to a model that looks for links between thought force and the factors in the Focus Test. We use one of the simplest stochastic models in mathematical statistics, because as Dr. Lajtner\'s colleague once said: "The simplest statistical methods are the best." This function works only with the user\'s explicit consent.'
      },
      {
        q: 'Can thought force be traced back to photons or electrons?',
        a: 'We don\'t believe it can be explained by photons or electrons. Dr. Lajtner has proposed a possible physical framework for it, described in papers available at lajtner.com/acadpaper.html'
      }
    ]
  },
  {
    title: 'The Lajtner Code App',
    items: [
      {
        q: 'What is the Lajtner Code?',
        a: 'The Lajtner Code is a focus-measurement platform created by Dr. Tamás Lajtner. It measures human focus by analyzing video of the spinning star (the rotor of the Lajtner Scope). Using AI-powered computer vision, the platform detects the star\'s rotation and calculates physics measurements including force, energy, power, and Lajtner Resonance.'
      },
      {
        q: 'Do I need a Lajtner Scope to use the Lajtner Code?',
        a: 'Yes. Every Lajtner Scope contains an NFC chip that gives you access to the Lajtner Code, including the free plan. Without the chip, no version of the Lajtner Code works, not even the free one.'
      },
      {
        q: 'Do I need the Lajtner Code to use the Lajtner Scope?',
        a: 'No. The Lajtner Scope also works without the Lajtner Code, but then you do not get measured data.'
      },
      {
        q: 'How does a measurement work?',
        a: 'You record a video of the spinning star, either by uploading a video file or using your webcam for a live stream. The AI model identifies the star and tracks its spokes in every frame. From this frame-by-frame angular data, the system computes angular velocity, acceleration, force, energy, peak power and Lajtner Resonance. No simulated data is used: every result is calculated from your real video. The video is stored as long as your account exists. Please do not show yourself in the video, because your image is personal data. If you do appear in it, you consent to your image being recorded.'
      },
      {
        q: 'What environments are supported for measurements?',
        a: 'Measurements can be performed in two environments: air (standard) and water (submerged star). Each uses the appropriate physical model. The star can spin clockwise or counter-clockwise. In our experience, you can change the direction of spin with your mental focus.'
      },
      {
        q: 'Does the Lajtner Code take rotor changes into account?',
        a: 'Yes. The Lajtner Code recognizes different rotors by itself, so you don\'t need to do anything. If you like, you can also tell the app manually that you are using a new rotor, but the app recognizes it anyway.'
      }
    ]
  },
  {
    title: 'Subscription Plans',
    items: [
      {
        q: 'What subscription plans are available?',
        a: 'There are three plans: Basic (Free) gives you video upload, live streaming, and personal physics results. Pro (Paid monthly) adds ranking among all users, group comparison, medals (gold/silver/bronze), and power vs. average charts. Ultimate (Paid monthly) includes everything in Pro plus the Statistics page with detailed factor analysis. Ultimate is also granted automatically with the purchase of a Lajtner Scope for a limited period.'
      }
    ]
  },
  {
    title: 'Lajtner Scope Series & Pricing',
    items: [
      {
        q: 'Which Lajtner Scope series are available?',
        a: 'There are four series, three of which are limited and individually numbered. Founder Series: $4,999 (50 units, No. 01–No. 50) — premium, made of metal and sapphire glass, especially for collectors. Pioneer Series: $249 (50 units, No. 01–No. 50) — especially for explorers. Spectrum Series: $499 (500 units, No. 001–No. 500) — for those who want to be among the first. Core Series: $299 — for everyone who joins later; serial number stored on chip only, not marked on the device.'
      },
      {
        q: 'How does NFC chip verification work?',
        a: 'When you tap your Lajtner Scope on a phone, the chip sends a cryptographically authenticated message that our server verifies. Each chip has a unique identifier linked to its serial number and your account. This confirms the chip is genuine and has not been cloned.'
      },
      {
        q: 'Can I have more than one Lajtner Scope in one account?',
        a: 'Yes. Your account is linked to your email address, and one account can have several measurement profiles. Each Lajtner Scope has its own measurement profile identified by its chip. One chip opens only one storage space.'
      },
      {
        q: 'If I sell my Lajtner Scope, can I still view my earlier results?',
        a: 'No. Results can only be accessed with the chip. Before you pass on your Lajtner Scope, you can download your Lajtner Resonance data and delete your data in the Lajtner Code.'
      },
      {
        q: 'If I buy a new Lajtner Scope, can I link it to my old account?',
        a: 'Yes, if your email address is still the same: the new Lajtner Scope gets its own measurement profile in your account, next to your earlier ones. If your email address has changed, please contact us first.'
      }
    ]
  },
  {
    title: 'Pioneer Program',
    items: [
      {
        q: 'What is the Pioneer Program?',
        a: 'Pioneer Series owners can submit a link to a published review of the product. Once we have checked that the review has been published, the owner receives a free surprise video unlock. The reward is given for the review itself; it does not depend on whether the review is positive or negative. Reviewers must clearly state that they received a reward. Pioneer owners also get an upgrade discount: $50 off a Founder Series or $20 off a Spectrum Series Lajtner Scope.'
      }
    ]
  },
  {
    title: 'Focus Test',
    items: [
      {
        q: 'What is the Focus Test?',
        a: 'The Focus Test is an 8-question questionnaire about mental and physical factors that may influence your results: illness, loneliness, sleep, homeostasis, stimulants, digital exposure, breathing, and emotions. After you complete it and perform measurements, the platform uses Odds Ratio and Chi-square statistical analysis to look for associations between these factors and the measured results. Focus Test results contain no individual data. An association is not proof of cause and effect, and the results are not medical advice.'
      },
      {
        q: 'When do Focus Test results become available?',
        a: 'You must answer all 8 questions to see the results. The system requires a minimum of 30 complete questionnaire submissions across all users before displaying results, to improve statistical reliability. Until then, a message explains that the database is still growing.'
      }
    ]
  },
  {
    title: 'Device Pairing',
    items: [
      {
        q: 'How does pairing work between my phone and my laptop?',
        a: 'On your laptop, start a pairing session — a QR code appears (valid for 5 minutes). On your phone, scan the QR code. Your phone reads the NFC chip in your Lajtner Scope to confirm your identity. The laptop receives a secure token and stays authorized. Your phone, together with the NFC chip in your Lajtner Scope, acts as a physical security key for desktop sessions.'
      }
    ]
  },
  {
    title: 'Store, Shipping & Returns',
    items: [
      {
        q: 'What is available in the online store?',
        a: 'The store offers digital products (instructional videos, PDF guides, presentations), physical products (Lajtner Scopes from all four series, and replaceable rotors with different masses — heavier or lighter than standard), and discount coupons. Shipping estimates come from the DHL international API or pre-configured flat rates.'
      },
      {
        q: 'What are the different rotors for?',
        a: 'For developing your skills. If one rotor has become too easy for you, move up a level and choose a rotor that is harder to turn. If it is too hard, choose a lighter rotor.'
      },
      {
        q: 'How long does delivery take?',
        a: 'We ship with DHL or other international shipping companies, so delivery times depend on the shipping company. For legal reasons, we currently ship primarily, but not exclusively, to the United States, and within the United States to California.'
      },
      {
        q: 'If I order and it is out of stock, how long will it take?',
        a: 'We accept an order only after the full amount has been paid. If the Lajtner Scope is not in stock, we manufacture it specifically for you, based on your order. This can take several weeks or several months, because some of our suppliers are very slow. We will let you know by email exactly how long it will take. As long as our suppliers have not officially refused to deliver the parts, we consider your order active. If you withdraw from your order after three months, you will get your money back after deduction of our costs. The Lajtner Scope is a rarity, and it is worth the wait.'
      },
      {
        q: 'How long is the return period, and is there a money-back guarantee?',
        a: 'For customers in the EU, the EEA and the UK: because of certain open legal issues, we currently do not ship to these areas, and therefore we do not accept orders from these countries. Once these issues have been resolved, we will ship there too. From then on, the following rules apply: you can withdraw from your purchase within 14 days of delivery without giving a reason. Send the product back within 14 days of telling us. We refund the purchase price, including standard delivery costs, within 14 days. You pay the cost of returning the product. For customers outside the EU/EEA/UK: we accept returns of unopened boxes sent back within 14 days of delivery with proof of payment.'
      },
      {
        q: 'Is there a warranty?',
        a: 'Yes. If the Lajtner Scope is used as intended, we provide a 2-year warranty for manufacturing defects. The warranty does not cover damage that happens after delivery, for example if the Lajtner Scope is dropped, broken or used improperly.'
      },
      {
        q: 'Do the prices include VAT or sales tax?',
        a: 'The prices shown in the shop do not include VAT or sales tax. When you add a product to your cart, you see the full price there, including VAT or sales tax (depending on where you live) and shipping costs. The same full price appears on your invoice, in line with common online practice.'
      },
      {
        q: 'Do I have to pay customs duties?',
        a: 'It depends on the country you are ordering to. If that country charges customs duties, the buyer must pay them.'
      },
      {
        q: 'What happens if my Lajtner Scope is lost?',
        a: 'If lost after delivery, we cannot replace it. If lost or damaged during shipping to you, that is our responsibility: we will send a new one or refund you. You also lose access to its data. Everyone receives a personal security code at their first login — with this code, you can contact support even without your chip, cancel your subscription and have your data deleted. If you have lost your personal security code, your data will still be deleted automatically: data stored in the Lajtner Code that has not been accessed (no login with the chip) for 12 months is deleted automatically at the end of that period, unless you have an active subscription. We will send you a reminder by email before your data is deleted. Invoicing and accounting data are kept for the period required by law.'
      }
    ]
  },
  {
    title: 'Account, Privacy & Data',
    items: [
      {
        q: 'How do I create an account?',
        a: 'To register, you need the chip in your Lajtner Scope. Register with your email and password on the login page. When you register, you confirm that you are an adult where you live. Registration is protected by CAPTCHA.'
      },
      {
        q: 'How do I log in?',
        a: 'First, your chip confirms that you have a Lajtner Scope. Then you enter your email address and password. At your first login, you also receive a personal security code — keep it safe. Without the chip, you cannot log in. You can visit the shop and contact support without a chip.'
      },
      {
        q: 'I forgot my password. What do I do?',
        a: 'Request a password reset on the login page. A 6-digit verification code is sent to your registered email. Enter the code to set a new password.'
      },
      {
        q: 'Is my measured data public?',
        a: 'No. We never publish any user\'s measured data in a way that could identify them personally. The anonymous leaderboard only shows, in numbers, how many users have better and weaker results and where you stand. You can delete your data at any time from within the Lajtner Code when you are logged in with your chip. Data that has not been accessed (no login with the chip) for 12 months is deleted automatically at the end of that period, unless you have an active subscription. We will send you a reminder by email before your data is deleted. Invoicing and accounting data are kept for the period required by law.'
      },
      {
        q: 'Can I download my data or get a copy of it?',
        a: 'Your data can only be accessed with the chip. You can download your Lajtner Resonance data at any time, and receive rotation speed, rotation time, Lajtner Time, Lajtner Jerk, angle of rotation, thought force in newtons, and the exact date. You can also receive your Focus Test answers. Request this data in the Lajtner Code when logged in with your chip.'
      },
      {
        q: 'Can children use the Lajtner Scope and the Lajtner Code?',
        a: 'The Lajtner Code is designed for users who are adults where they live and who can take full legal responsibility for their use of the app. We do not support use by minors. When you register, you confirm that you are an adult. We ask parents to supervise their children\'s online activities.'
      },
      {
        q: 'Can I reject cookies?',
        a: 'Partly. Some cookies are strictly necessary: the Lajtner Code does not work without them, so they cannot be rejected. Other cookies are optional, and you can reject them; the Lajtner Code still works without them. We do not use cookies for advertising or to track you on other websites, and we do not collect data for third parties. For details, see our Privacy Policy.'
      },
      {
        q: 'Can I switch between dark and light mode?',
        a: 'Yes. A theme toggle is available in the sidebar to switch between dark and light visual modes.'
      },
      {
        q: 'How do I contact support?',
        a: 'Use the live chat widget on the platform or visit the Contact page, which links to the feedback form. You don\'t need a chip to contact support.'
      }
    ]
  },
  {
    title: 'Videos',
    items: [
      {
        q: 'Are there free videos, or only paid ones?',
        a: 'There are free videos too. Every Lajtner Scope comes with 3 videos at no extra cost: one about L-Thinking by Lajtner, one about the hardware, and one about the app. Some series, such as the Founder Series, include additional bonus videos. All our videos are real: no AI-generated footage, no animation, no magic tricks, no film tricks and no time-lapse. In some places we speed up the footage and always indicate how much.'
      }
    ]
  }
]

/* ── Product schema data ──────────────────────────────────── */
const PRODUCTS = [
  {
    name: 'Lajtner Scope Founder Series',
    description: 'Premium limited-edition focus measurement device made of metal and sapphire glass, with NTAG 424 DNA cryptographic NFC chip. 50 individually numbered units (No. 01–No. 50). Especially for collectors. Includes Ultimate subscription access and bonus videos.',
    sku: 'LAJTNER-FOUNDER',
    price: '4999.00',
    currency: 'USD',
    availability: 'https://schema.org/LimitedAvailability',
    brand: 'Lajtner',
    category: 'Scientific Measurement Devices',
    url: 'https://mindpw.com/kinetic/store'
  },
  {
    name: 'Lajtner Scope Pioneer Series',
    description: 'Limited-edition focus measurement device with NTAG 424 DNA cryptographic NFC chip. 50 individually numbered units (No. 01–No. 50). Especially for explorers. Includes Ultimate subscription access and Pioneer Program eligibility.',
    sku: 'LAJTNER-PIONEER',
    price: '249.00',
    currency: 'USD',
    availability: 'https://schema.org/LimitedAvailability',
    brand: 'Lajtner',
    category: 'Scientific Measurement Devices',
    url: 'https://mindpw.com/kinetic/store'
  },
  {
    name: 'Lajtner Scope Spectrum Series',
    description: 'Focus measurement device with NTAG 424 DNA cryptographic NFC chip. 500 individually numbered units (No. 001–No. 500). For those who want to be among the first to use the Lajtner Scope.',
    sku: 'LAJTNER-SPECTRUM',
    price: '499.00',
    currency: 'USD',
    availability: 'https://schema.org/InStock',
    brand: 'Lajtner',
    category: 'Scientific Measurement Devices',
    url: 'https://mindpw.com/kinetic/store'
  },
  {
    name: 'Lajtner Scope Core Series',
    description: 'Focus measurement device with NTAG 424 DNA cryptographic NFC chip. Each unit has a unique serial number stored on the chip. For everyone who joins. Includes subscription benefits and platform access.',
    sku: 'LAJTNER-CORE',
    price: '299.00',
    currency: 'USD',
    availability: 'https://schema.org/InStock',
    brand: 'Lajtner',
    category: 'Scientific Measurement Devices',
    url: 'https://mindpw.com/kinetic/store'
  }
]

/* ── Schema.org JSON-LD ───────────────────────────────────── */
function buildFaqSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_SECTIONS.flatMap(s => s.items).map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  }
}

function buildProductSchemas() {
  return PRODUCTS.map(p => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description,
    sku: p.sku,
    brand: { '@type': 'Brand', name: p.brand },
    category: p.category,
    url: p.url,
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: p.currency,
      availability: p.availability,
      seller: {
        '@type': 'Organization',
        name: 'Lajtner',
        url: 'https://mindpw.com/kinetic'
      }
    }
  }))
}

function buildOrgSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Lajtner',
    url: 'https://mindpw.com/kinetic',
    founder: { '@type': 'Person', name: 'Dr. Tamás Lajtner' },
    description: 'Focus-measurement platform that measures human thought force through AI-powered computer vision and calculates Lajtner Resonance.',
    sameAs: ['https://lajtnerresonance.com', 'https://lajtner.com']
  }
}

/* ── Component ────────────────────────────────────────────── */
export default function FAQ() {
  const [openIdx, setOpenIdx] = useState(null)

  const toggle = key => setOpenIdx(prev => prev === key ? null : key)

  /* Inject schema.org JSON-LD into <head> */
  useEffect(() => {
    const schemas = [
      buildFaqSchema(),
      ...buildProductSchemas(),
      buildOrgSchema()
    ]
    const scripts = schemas.map(schema => {
      const el = document.createElement('script')
      el.type = 'application/ld+json'
      el.textContent = JSON.stringify(schema)
      document.head.appendChild(el)
      return el
    })
    document.title = 'FAQ — Lajtner Code'
    return () => scripts.forEach(el => el.remove())
  }, [])

  return (
    <>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '.3rem' }}>
          Frequently Asked Questions
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '.95rem' }}>
          Everything you need to know about the Lajtner Scope, the Lajtner Code, thought force, and our devices.
        </p>

        {FAQ_SECTIONS.map((section, si) => (
          <div key={si} style={{ marginBottom: '1.8rem' }}>
            <h2 style={{
              fontSize: '1.1rem',
              color: 'var(--green)',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '.4rem',
              marginBottom: '.8rem'
            }}>
              {section.title}
            </h2>

            {section.items.map((item, ii) => {
              const key = `${si}-${ii}`
              const isOpen = openIdx === key
              return (
                <div key={key} style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  marginBottom: '.5rem',
                  overflow: 'hidden',
                  transition: 'border-color .2s',
                  borderColor: isOpen ? 'var(--green)' : 'var(--border)'
                }}>
                  <button
                    onClick={() => toggle(key)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '.85rem 1rem',
                      background: 'none',
                      border: 'none',
                      color: 'var(--fg)',
                      fontSize: '.95rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                      gap: '.5rem'
                    }}
                  >
                    <span>{item.q}</span>
                    <span style={{
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform .2s',
                      flexShrink: 0,
                      fontSize: '1.1rem',
                      opacity: .6
                    }}>
                      ▾
                    </span>
                  </button>

                  {isOpen && (
                    <div style={{
                      padding: '0 1rem .85rem',
                      color: 'var(--muted)',
                      fontSize: '.9rem',
                      lineHeight: 1.6
                    }}>
                      {item.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* Product cards for SEO visibility */}
        <div style={{ marginTop: '2.5rem' }}>
          <h2 style={{
            fontSize: '1.1rem',
            color: 'var(--green)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '.4rem',
            marginBottom: '.8rem'
          }}>
            Our Devices
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1rem'
          }}>
            {PRODUCTS.map((p, i) => (
              <div key={i} style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '.4rem'
              }}>
                <span style={{ fontSize: '.75rem', color: 'var(--green)', fontWeight: 700, letterSpacing: '.04em' }}>
                  {p.sku.replace('LAJTNER-', '')} SERIES
                </span>
                <span style={{ fontWeight: 600, fontSize: '.95rem' }}>{p.name.replace('Lajtner Scope ', '')}</span>
                <span style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--amber)' }}>
                  ${Number(p.price).toLocaleString()}
                </span>
                <span style={{ fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  {p.description.split('.')[0]}.
                </span>
                <span style={{
                  fontSize: '.7rem',
                  marginTop: '.3rem',
                  color: p.availability.includes('Limited') ? 'var(--amber)' : 'var(--green)',
                  fontWeight: 600
                }}>
                  {p.availability.includes('Limited') ? 'Limited Availability' : 'In Stock'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ marginTop: '2rem', fontSize: '.85rem', color: 'var(--dim)', textAlign: 'center' }}>
          Learn more at{' '}
          <a href="https://lajtnerresonance.com" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--green)' }}>
            lajtnerresonance.com
          </a>
        </p>
      </div>
    </>
  )
}