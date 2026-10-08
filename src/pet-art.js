/*
 * 花伴课堂 · 原创成长伙伴插画
 * Drawn for this project from simple SVG geometry; no external assets or fonts.
 * Seven full poses/scenes, forty distinct species (280 original illustrations). Safe in browsers and CommonJS.
 */
(function (root) {
  'use strict';

  const names = Object.freeze({
    owl: '星星猫头鹰', fox: '暖暖小狐狸', bunny: '软软兔', cat: '薄荷猫',
    penguin: '围巾企鹅', panda: '竹叶熊猫', bear: '蜂蜜小熊', dog: '饼干小狗',
    deer: '森林小鹿', squirrel: '橡果松鼠', hedgehog: '栗子刺猬', raccoon: '月光浣熊',
    koala: '云朵考拉', elephant: '泡泡小象', lion: '太阳小狮', tiger: '橙纹小虎',
    dragon: '芽芽小龙', unicorn: '星愿独角兽', otter: '溪流海獭', seal: '雪团海豹',
    robot: '星核机甲', rover: '岩虎机车', mechcrab: '铁钳蟹', mechbeetle: '锹甲先锋', mechdragonfly: '旋翼蜻蜓',
    rex: '炎石霸王龙', raptor: '疾风迅猛龙', triceratops: '岩盾三角龙', stegosaurus: '棱叶剑龙', ankylosaurus: '锤尾甲龙',
    pteranodon: '长空翼龙', mammoth: '雪岭猛犸', rhino: '岩角犀牛', gorilla: '岩臂大猩猩', wolf: '霜影狼',
    boar: '赤鬃野猪', eagle: '峰翼鹰', shark: '深蓝鲨', orca: '逐浪虎鲸', phoenix: '曦羽凤凰'
  });
  const stages = Object.freeze(['破壳宝宝', '元气运动', '力量伙伴', '出发旅行', '飞行探索', '智慧学者', '星光守护']);
  const palettes = Object.freeze({
    owl:   { fur: '#B5A0E2', light: '#EEE6FA', dark: '#8771BB', ink: '#62517C', accent: '#F3C568', cheek: '#ECAEC4' },
    fox:   { fur: '#F1AD77', light: '#FFF0DB', dark: '#D78959', ink: '#925F51', accent: '#85C8C1', cheek: '#F19D9D' },
    bunny: { fur: '#F5D9DD', light: '#FFF8F0', dark: '#DFAAAB', ink: '#996D7F', accent: '#A79AD6', cheek: '#F09EAD' },
    cat:   { fur: '#A4CDBF', light: '#E9F6EA', dark: '#72A893', ink: '#527F76', accent: '#E8BA76', cheek: '#F0B6AB' },
    penguin:  { fur: '#7295AD', light: '#F6FAF8', dark: '#4F718B', ink: '#3F596F', accent: '#F2B56B', cheek: '#EFA9A7' },
    panda:    { fur: '#F3F2DF', light: '#FFFDF1', dark: '#657573', ink: '#485B58', accent: '#99C691', cheek: '#E7ACAA' },
    bear:     { fur: '#DCAF78', light: '#FBE6BD', dark: '#B88852', ink: '#805F48', accent: '#E6BC56', cheek: '#E79E8E' },
    dog:      { fur: '#ECC58F', light: '#FFF0D4', dark: '#B78559', ink: '#795E4D', accent: '#8EBBCC', cheek: '#E6A296' },
    deer:     { fur: '#D5AA84', light: '#FFF0DB', dark: '#A17959', ink: '#795D4D', accent: '#A4BD7F', cheek: '#E5A492' },
    squirrel: { fur: '#D49D75', light: '#FDE5BF', dark: '#AD7658', ink: '#80594C', accent: '#AEBE7B', cheek: '#E6A491' },
    hedgehog: { fur: '#D1AF92', light: '#FAE7CB', dark: '#9C7E73', ink: '#78605B', accent: '#E4AA75', cheek: '#E3A0A0' },
    raccoon:  { fur: '#A6B1BF', light: '#F0F1EB', dark: '#697787', ink: '#4D5D70', accent: '#CAB5DF', cheek: '#E5A7B0' },
    koala:    { fur: '#B5BFCD', light: '#F3F0EB', dark: '#8996AB', ink: '#606C83', accent: '#B3CCAA', cheek: '#E9B1BF' },
    elephant: { fur: '#ACBCD9', light: '#DBE7F6', dark: '#879DC3', ink: '#5F739C', accent: '#C1B2E2', cheek: '#E2B7CF' },
    lion:     { fur: '#E9C176', light: '#FFF0CE', dark: '#C79565', ink: '#8C664D', accent: '#EBC46E', cheek: '#E7A08C' },
    tiger:    { fur: '#EBB278', light: '#FFF0DC', dark: '#A67656', ink: '#825A44', accent: '#9DBEAB', cheek: '#E29B8F' },
    dragon:   { fur: '#A2CDAA', light: '#EDF0C5', dark: '#73A888', ink: '#4D7C66', accent: '#C5ADD7', cheek: '#ECADAF' },
    unicorn:  { fur: '#F0E5F4', light: '#FFFAF3', dark: '#B7A2D3', ink: '#8A729D', accent: '#E7C575', cheek: '#EDB2CA' },
    otter:    { fur: '#BCA18A', light: '#F4E8D6', dark: '#92796B', ink: '#6B5D55', accent: '#89BFC5', cheek: '#DFA395' },
    seal:     { fur: '#DCE9EF', light: '#FCFCF3', dark: '#A7C3CF', ink: '#6A8A9C', accent: '#A6B4DB', cheek: '#E8B5C3' },
    robot:       { fur: '#739BC1', light: '#E0F1F5', dark: '#497396', ink: '#35516B', accent: '#F3C75F', cheek: '#E9A898' },
    rover:       { fur: '#D6AA68', light: '#F7E5B5', dark: '#77836B', ink: '#565E4C', accent: '#77BFC3', cheek: '#E8AB88' },
    mechcrab:    { fur: '#E37E65', light: '#FFE8C4', dark: '#B65850', ink: '#7E484C', accent: '#83CBD0', cheek: '#F2B7A1' },
    mechbeetle:  { fur: '#799987', light: '#DFE9BC', dark: '#4E7769', ink: '#355A54', accent: '#DDB760', cheek: '#E3AE8D' },
    mechdragonfly:{ fur: '#67AEAB', light: '#DDF6EE', dark: '#40878A', ink: '#38616F', accent: '#F0B768', cheek: '#ECAAA2' },
    rex:         { fur: '#D39468', light: '#FBE7BB', dark: '#A36350', ink: '#785041', accent: '#8CB7A0', cheek: '#EAA288' },
    raptor:      { fur: '#85A48A', light: '#EAF0C9', dark: '#567967', ink: '#3E6157', accent: '#E1AE69', cheek: '#DDAF93' },
    triceratops: { fur: '#9C91BA', light: '#EDE3D6', dark: '#766391', ink: '#5C5377', accent: '#D9B874', cheek: '#DAA4B2' },
    stegosaurus: { fur: '#80B198', light: '#E4EDC2', dark: '#54886E', ink: '#406D5B', accent: '#DD9969', cheek: '#E6B29B' },
    ankylosaurus:{ fur: '#B6A276', light: '#F4E7BD', dark: '#80734F', ink: '#5F5C43', accent: '#8FBCA9', cheek: '#D9A389' },
    pteranodon:  { fur: '#77A6C0', light: '#DBF0EC', dark: '#567B9F', ink: '#405C7A', accent: '#E8BB70', cheek: '#E1A6A7' },
    mammoth:     { fur: '#AA8B78', light: '#F2E4C8', dark: '#7D6258', ink: '#614B46', accent: '#94B6C5', cheek: '#D7A098' },
    rhino:       { fur: '#A8ADBD', light: '#E9E8E2', dark: '#7C899D', ink: '#5B667C', accent: '#8CC3B7', cheek: '#DDA9B4' },
    gorilla:     { fur: '#7F8797', light: '#CED1D6', dark: '#555F72', ink: '#404B5E', accent: '#D7B770', cheek: '#DDA7A5' },
    wolf:        { fur: '#87A6BA', light: '#E8F2EB', dark: '#5C7C93', ink: '#455E77', accent: '#C7B6DC', cheek: '#DDA5B3' },
    boar:        { fur: '#B68167', light: '#F1CEAD', dark: '#835F50', ink: '#624A43', accent: '#D6AD66', cheek: '#D89082' },
    eagle:       { fur: '#AC9477', light: '#FBF0D9', dark: '#7B6657', ink: '#5E534A', accent: '#E8BB60', cheek: '#DFAE93' },
    shark:       { fur: '#80AEC7', light: '#E7F5F1', dark: '#5487AC', ink: '#3E6384', accent: '#EBC071', cheek: '#D8AFBB' },
    orca:        { fur: '#5F778E', light: '#F3F6E8', dark: '#3F5B72', ink: '#334D65', accent: '#8DC6CA', cheek: '#DAADBD' },
    phoenix:     { fur: '#E6A064', light: '#FFF0BF', dark: '#BA7459', ink: '#8D584C', accent: '#DFC265', cheek: '#E8978D' }

  });
  const outline = 'stroke-linecap="round" stroke-linejoin="round"';
  const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
  const circle = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
  const ellipse = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
  const line = (d, color, width = 3, extra = '') => path(d, 'none', `stroke="${color}" stroke-width="${width}" ${outline} ${extra}`);
  const shape = (d, fill, p, width = 3) => path(d, fill, `stroke="${p.ink}" stroke-width="${width}" ${outline}`);
  const rounded = (x, y, w, h, r, fill, p) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${p.ink}" stroke-width="3" ${outline}/>`;
  const star = (x, y, s, fill, stroke = '') => `<path d="M0 -10 3.2 -3.2 10 -2 5 3 6 10 0 6.6 -6 10 -5 3 -10 -2 -3.2 -3.2Z" transform="translate(${x} ${y}) scale(${s})" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="1.8" ${outline}` : ''}/>`;
  const sparkle = (x, y, s, fill) => `<path d="M0 -8Q1 -1 8 0Q1 1 0 8Q-1 1 -8 0Q-1 -1 0 -8Z" transform="translate(${x} ${y}) scale(${s})" fill="${fill}"/>`;

  function ground(p, wide = 75) {
    return ellipse(120, 213, wide, 9, p.dark, 'opacity=".11"');
  }
  function cloud(x, y, scale = 1) {
    return `<g transform="translate(${x} ${y}) scale(${scale})">${path('M-29 10Q-43 9 -39 -3Q-36 -13 -25 -11Q-25 -28 -9 -28Q7 -30 12 -15Q28 -22 33 -7Q48 -6 44 8Q41 15 26 15H-23Z', '#FFFFFF', 'stroke="#DEE9EF" stroke-width="2.5"')}</g>`;
  }
  function tail(type, p, pose) {
    if (type === 'fox') return shape(pose === 'fly' ? 'M146 155Q191 167 207 117Q181 119 177 91Q159 97 158 124Q157 143 138 142Z' : 'M148 165Q199 171 200 122Q179 129 173 103Q152 115 166 141Q165 150 148 148Z', p.fur, p) + path(pose === 'fly' ? 'M197 139Q205 129 207 117Q181 119 177 91Q167 96 163 104Q177 129 197 139Z' : 'M194 147Q201 135 200 122Q179 129 173 103Q164 108 161 117Q169 141 194 147Z', p.light);
    if (type === 'cat') return line(pose === 'fly' ? 'M150 157Q189 169 195 139Q199 122 187 117' : 'M150 178Q194 185 196 151Q197 139 187 140', p.ink, 19) + line(pose === 'fly' ? 'M150 157Q189 169 195 139Q199 122 187 117' : 'M150 178Q194 185 196 151Q197 139 187 140', p.fur, 13);
    if (type === 'bunny') return circle(160, 168, 17, p.light, `stroke="${p.ink}" stroke-width="3"`);
    return shape('M104 177 103 198 116 194 121 201 128 193 139 197 139 177Z', p.dark, p);
  }
  function feet(p, pose) {
    if (pose === 'run') return shape('M105 174Q102 186 89 188L73 180Q64 178 64 187Q63 193 77 199L93 202Q110 200 119 185Z', p.dark, p) + shape('M128 172Q143 178 148 190L157 190Q170 193 163 201Q153 208 143 201L122 187Z', p.dark, p);
    if (pose === 'fly') return shape('M106 165Q90 172 85 184Q93 192 105 185L120 173Z', p.dark, p) + shape('M131 166 142 184Q154 191 162 181L145 162Z', p.dark, p);
    return ellipse(103, 192, 18, 10, p.dark, `stroke="${p.ink}" stroke-width="3"`) + ellipse(138, 192, 18, 10, p.dark, `stroke="${p.ink}" stroke-width="3"`);
  }
  function body(type, p, pose) {
    if (isAdventureSpecies(type)) return adventureBody(type, p, pose);
    if (isNewSpecies(type)) return speciesBody(type, p, pose);
    const belly = type === 'owl' ? p.light : p.light;
    let s = tail(type, p, pose) + feet(p, pose);
    s += shape('M96 125Q75 140 82 171Q85 191 120 192Q154 192 159 170Q166 140 145 125Z', p.fur, p);
    s += ellipse(121, 161, 25, 26, belly);
    if (type === 'owl') s += line('M109 153 114 157 119 153M125 164 130 168 135 163M106 170 111 174 116 170', p.dark, 2.7);
    if (pose === 'run') {
      s += shape('M90 136Q75 129 67 141L60 155Q62 162 70 159L86 149', p.fur, p);
      s += shape('M149 139Q159 142 163 128L161 119Q166 110 174 117L176 132Q172 153 151 158', p.fur, p);
    } else if (pose === 'power') {
      s += shape('M93 144Q77 155 63 140L54 125Q48 120 43 127L47 147Q63 171 91 164', p.fur, p);
      s += shape('M148 144Q164 155 178 140L188 125Q194 120 199 127L194 147Q178 171 150 164', p.fur, p);
    } else if (pose === 'travel') {
      s += shape('M93 144Q77 156 84 171Q93 176 98 166L103 151', p.fur, p);
      s += shape('M144 139Q161 145 174 137Q182 136 182 144Q177 154 152 159', p.fur, p);
    } else if (pose === 'fly') {
      s += shape('M95 137Q76 129 66 141L49 153Q48 164 61 162L96 155', p.fur, p);
      s += shape('M146 136Q164 128 177 135L191 145Q194 155 184 157L147 153', p.fur, p);
    } else if (pose === 'guard') {
      s += shape('M93 141Q72 141 71 164Q76 175 86 166L102 153', p.fur, p);
      s += shape('M146 140Q164 145 180 132Q190 133 189 142Q177 158 153 160', p.fur, p);
    } else {
      s += shape('M91 139Q77 146 82 167Q91 177 99 166L104 148', p.fur, p);
      s += shape('M150 139Q164 145 160 167Q151 176 143 166L140 148', p.fur, p);
    }
    return s;
  }
  function head(type, p, expression = 'happy') {
    if (isAdventureSpecies(type)) return adventureHead(type, p, expression);
    if (isNewSpecies(type)) return speciesHead(type, p, expression);
    let s = '';
    if (type === 'bunny') {
      s += shape('M89 83Q67 27 82 21Q98 14 107 73Z', p.fur, p);
      s += shape('M132 75Q145 15 162 25Q174 36 151 88Z', p.fur, p);
      s += path('M91 64Q79 32 85 29Q91 28 101 69Z', '#EFB2C1');
      s += path('M140 70Q151 29 157 32Q162 37 148 73Z', '#EFB2C1');
      s += shape('M74 104Q74 73 105 72Q117 67 130 72Q165 71 167 104Q178 136 150 143Q121 157 89 144Q64 137 74 104Z', p.fur, p);
    } else if (type === 'fox') {
      s += shape('M75 93 72 47Q77 37 103 74L137 75Q164 37 170 48L167 101Z', p.fur, p);
      s += path('M82 78 81 55 97 78ZM145 80 160 56 161 83Z', p.dark);
      s += shape('M76 87Q96 69 120 76Q146 69 165 88L177 116 164 117 171 128Q148 146 121 149Q91 146 68 127L76 116 64 114Z', p.fur, p);
      s += path('M70 116Q83 105 98 108L120 124 144 108Q161 105 171 116L163 119 166 128Q146 143 121 146Q94 141 76 127L80 119Z', p.light);
      s += path('M110 80Q118 77 126 79L116 91 124 87 119 99Z', p.dark, 'opacity=".6"');
    } else if (type === 'cat') {
      s += shape('M73 96 77 55Q78 48 102 75Q121 71 140 76L164 52Q171 49 169 97Q179 127 158 141Q122 160 85 142Q65 132 73 96Z', p.fur, p);
      s += path('M83 82 84 64 99 82ZM145 83 162 63 161 85Z', '#EAB2AD');
      s += path('M113 75 116 90Q120 95 123 90L127 75ZM97 81 102 92M140 81 137 92', p.dark, `stroke="${p.dark}" stroke-width="3" ${outline}`);
      s += ellipse(120, 129, 26, 16, p.light);
      s += line('M74 116 63 111M75 125 62 128M166 116 177 111M165 125 179 128', p.ink, 2.5);
    } else {
      s += shape('M77 87 70 59Q69 51 77 56L101 71Q120 63 140 72L163 56Q171 51 169 61L163 87Q178 112 164 136Q145 151 120 149Q94 152 77 136Q61 112 77 87Z', p.fur, p);
      s += path('M78 99Q84 78 104 82Q115 84 120 92Q128 80 141 83Q165 84 164 108Q164 136 140 135Q125 136 120 125Q112 139 98 135Q74 132 78 99Z', p.light);
      s += line('M97 73 102 81M116 69 121 78M135 73 139 80', p.dark, 3);
    }
    const eyesY = type === 'owl' ? 107 : 108;
    if (expression === 'sleepy') {
      s += line(`M94 ${eyesY}Q101 ${eyesY + 7} 108 ${eyesY}M132 ${eyesY}Q139 ${eyesY + 7} 146 ${eyesY}`, p.ink, 3.6);
    } else {
      s += ellipse(102, eyesY, type === 'owl' ? 7.5 : 5.3, type === 'owl' ? 10 : 7.8, p.ink);
      s += ellipse(140, eyesY, type === 'owl' ? 7.5 : 5.3, type === 'owl' ? 10 : 7.8, p.ink);
      s += circle(104, eyesY - 3, 2.4, '#FFFFFF') + circle(142, eyesY - 3, 2.4, '#FFFFFF');
    }
    s += ellipse(type === 'owl' ? 86 : 87, 124, 8, 4.5, p.cheek, 'opacity=".85"');
    s += ellipse(type === 'owl' ? 155 : 154, 124, 8, 4.5, p.cheek, 'opacity=".85"');
    if (type === 'owl') s += shape('M114 118Q120 114 126 118L121 125Q119 127 117 124Z', p.accent, p, 2);
    else s += path('M116 121Q121 118 126 121L122 126Q120 128 118 125Z', type === 'bunny' ? '#D894A5' : p.ink);
    s += line(type === 'owl' ? 'M115 132Q121 137 127 132' : 'M121 126V129Q115 136 111 129M121 129Q128 136 132 129', p.ink, 2.2);
    return s;
  }

  // The four original companions deliberately retain their original drawing path.
  // New companions have their own silhouettes, tails, ears and facial anatomy.
  const isNewSpecies = type => type !== 'owl' && type !== 'fox' && type !== 'bunny' && type !== 'cat';
  const rim = p => `stroke="${p.ink}" stroke-width="3" ${outline}`;
  const bean = (x, y, rx, ry, color, p) => ellipse(x, y, rx, ry, color, rim(p));
  function speciesTail(type, p, pose) {
    if (type === 'squirrel') {
      return shape('M143 171Q179 185 196 157Q218 120 196 94Q178 77 161 99Q151 115 164 129Q179 142 189 122Q193 139 176 146L145 143Z', p.fur, p)
        + line('M165 104Q181 89 192 108Q202 130 183 153Q167 166 148 157', p.light, 8);
    }
    if (type === 'raccoon') {
      return shape('M145 166Q168 179 181 157Q194 135 203 148Q214 172 189 187Q163 205 143 185Z', p.fur, p)
        + path('M167 173 180 183 170 194 158 181ZM185 152 204 156 205 167 181 164ZM145 177 154 190 147 188Z', p.dark);
    }
    if (type === 'dragon') {
      return shape('M148 169Q182 179 188 155L181 155 197 132 209 154 199 155Q194 195 149 188Z', p.fur, p)
        + shape('M182 159 175 149 187 147M174 175 172 164 183 165', p.accent, p, 2);
    }
    if (type === 'unicorn') {
      return shape('M152 152Q186 133 192 160Q188 176 202 183Q176 194 167 176Q165 164 152 167Z', '#D3BDE7', p)
        + line('M162 154Q182 148 179 165Q177 179 193 182', '#B0D5D0', 6)
        + line('M163 160Q173 158 172 172Q174 182 183 185', '#E8B7CC', 5);
    }
    if (type === 'otter') return shape('M147 165Q173 174 190 193Q186 209 168 203Q141 195 134 178Z', p.dark, p) + line('M151 180 177 197', p.fur, 3);
    if (type === 'seal') return shape('M151 176Q182 174 190 156Q196 150 201 157Q207 165 195 176Q215 175 214 185Q211 198 178 194L154 194Z', p.dark, p) + line('M183 184 199 168M186 187 203 186', p.light, 2.4);
    if (type === 'lion') return line('M149 177Q180 198 190 173L191 157', p.ink, 9) + line('M149 177Q180 198 190 173L191 157', p.fur, 5) + shape('M190 164Q176 157 187 139Q207 146 198 160Z', p.dark, p);
    if (type === 'tiger') return line('M150 176Q185 190 194 165Q198 152 190 147', p.ink, 14) + line('M150 176Q185 190 194 165Q198 152 190 147', p.fur, 9) + line('M169 187 172 176M185 181 181 172M197 167 188 164', p.ink, 5);
    if (type === 'dog') return shape('M147 172Q174 180 184 163Q189 154 186 144Q206 160 188 182Q168 197 145 185Z', p.dark, p);
    if (type === 'elephant') return line('M151 168Q180 175 180 159', p.ink, 5) + shape('M180 162 173 155 181 147 187 158Z', p.dark, p, 2);
    if (type === 'deer') return shape('M149 164Q180 170 171 148Q163 149 151 153Z', p.fur, p) + path('M154 163Q169 165 169 154L154 157Z', p.light);
    if (type === 'hedgehog') return shape('M88 140 58 134 62 118 48 110 62 101 53 88 70 85 67 70 82 76 88 59 101 68 115 54 125 67 141 57 148 73 167 68 167 84 185 83 181 100 195 108 184 122 193 137 180 146 180 167 164 167Z', p.dark, p)
      + line('M68 98 78 105M77 80 87 91M97 72 101 83M142 73 138 85M166 93 159 102M179 122 168 127M70 124 79 130', p.fur, 3.5);
    if (type === 'panda' || type === 'bear' || type === 'koala') return bean(158, 174, 12, 12, type === 'panda' ? p.dark : p.fur, p);
    return '';
  }
  function speciesLimbs(type, p, pose) {
    const fur = type === 'panda' ? p.dark : p.fur;
    if (type === 'penguin' || type === 'seal') {
      const spread = pose === 'fly' || pose === 'run';
      const left = pose === 'power' ? 'M93 140Q73 139 58 120Q48 113 44 124Q47 148 81 160L100 151Z' : spread ? 'M91 134Q71 128 51 146Q41 164 58 164Q78 158 99 149Z' : 'M87 138Q65 143 56 169Q56 182 69 174L99 151Z';
      const right = pose === 'power' ? 'M146 140Q167 139 184 120Q193 113 199 124Q193 148 160 160L143 151Z' : spread ? 'M149 135Q169 122 191 136Q203 149 190 154L146 154Z' : 'M151 138Q174 141 182 164Q183 180 171 173L144 151Z';
      return shape(left, type === 'penguin' ? p.dark : fur, p) + shape(right, type === 'penguin' ? p.dark : fur, p)
        + (type === 'seal' && !spread && pose !== 'power' ? line('M58 163 69 157M177 166 164 155', p.dark, 2.3) : '');
    }
    let s = '';
    if (pose === 'power') {
      s = shape('M94 143Q78 154 64 138L57 122Q51 115 44 124L48 146Q65 171 95 163Z', fur, p)
        + shape('M147 143Q162 154 177 138L184 122Q191 115 198 124L194 146Q177 171 146 164Z', fur, p);
    } else if (pose === 'run') {
      s = shape('M94 138Q77 129 65 140L57 154Q59 164 69 159L97 150Z', fur, p)
        + shape('M147 140Q160 143 163 128L162 118Q167 108 175 117L178 133Q171 156 147 155Z', fur, p);
    } else if (pose === 'fly') {
      s = shape('M97 136Q77 129 64 140L47 153Q47 164 60 162L99 154Z', fur, p)
        + shape('M145 136Q165 129 179 135L193 145Q196 156 183 158L144 153Z', fur, p);
    } else if (pose === 'travel' || pose === 'guard') {
      s = shape('M92 141Q76 145 79 166Q85 178 94 166L104 150Z', fur, p)
        + shape('M147 139Q162 145 176 134Q185 132 187 140Q181 156 147 158Z', fur, p);
    } else {
      s = shape('M92 139Q76 145 79 163Q85 177 96 167L104 148Z', fur, p)
        + shape('M149 139Q165 145 162 164Q156 178 146 167L139 149Z', fur, p);
    }
    if (type === 'tiger') s += line('M84 145 92 151M157 144 151 151', p.ink, 4);
    if (type === 'otter') s += line(pose === 'power' ? 'M48 128 55 131M188 127 194 130' : 'M83 162 91 165M153 161 160 158', p.dark, 2);
    return s;
  }
  function speciesBody(type, p, pose) {
    let s = speciesTail(type, p, pose);
    if (type === 'dragon') {
      s += shape('M91 134Q67 103 39 104L49 127 40 141Q59 136 65 153L78 151 90 168Z', p.accent, p)
        + shape('M149 134Q174 104 204 109L192 129 204 144Q184 138 176 156L163 153 151 168Z', p.accent, p)
        + line('M51 114 88 155M48 138 88 155M193 118 152 155M195 141 152 155', p.light, 2.5);
    }
    if (type === 'penguin') {
      s += shape('M93 182 83 195 104 199 119 191 114 180ZM127 181 124 191 143 199 161 194 147 180Z', p.accent, p);
      s += shape('M97 119Q84 132 79 166Q74 190 105 197Q139 205 158 185Q167 166 147 120Z', p.fur, p);
      s += ellipse(120, 163, 29, 31, p.light);
    } else if (type === 'seal') {
      s += shape('M91 124Q74 146 79 172Q78 194 107 199Q151 207 178 190Q166 180 159 158L148 126Z', p.fur, p);
      s += ellipse(120, 172, 30, 24, p.light);
      s += bean(98, 192, 15, 6, p.dark, p);
    } else {
      s += feet(p, pose);
      const silhouette = type === 'deer' ? 'M101 125Q90 141 88 168Q87 190 120 192Q151 191 151 169Q149 140 140 124Z'
        : type === 'otter' ? 'M103 120Q88 142 85 168Q82 193 120 197Q154 194 154 173Q149 140 140 121Z'
        : type === 'elephant' ? 'M92 121Q73 145 81 172Q85 194 120 195Q157 193 161 170Q166 143 145 122Z'
        : type === 'unicorn' ? 'M98 121Q87 137 90 170Q92 192 121 193Q151 194 153 169Q151 140 140 121Z'
        : 'M95 123Q76 139 81 169Q83 193 120 196Q158 193 161 169Q166 140 145 124Z';
      s += shape(silhouette, p.fur, p);
      s += ellipse(120, 163, type === 'bear' ? 27 : 24, 26, p.light);
      if (type === 'panda') s += path('M81 143Q120 161 160 142L160 157Q120 174 81 157Z', p.dark);
      if (type === 'deer') s += circle(91, 156, 4, p.light) + circle(99, 143, 3.5, p.light) + circle(148, 156, 4, p.light) + circle(142, 144, 3.5, p.light);
      if (type === 'tiger') s += path('M84 142 101 149 85 152ZM157 143 141 151 158 154ZM85 169 99 171 87 179ZM157 170 143 172 154 180Z', p.ink);
      if (type === 'dragon') s += line('M104 149H135M100 161H140M103 174H138', p.dark, 2.4);
      if (type === 'bear') s += path('M110 151Q120 146 130 151L130 164Q120 172 110 164Z', p.accent) + line('M109 151H131', p.dark, 3);
      if (type === 'unicorn') s += star(120, 165, .75, p.accent);
      if (type === 'elephant') s += line('M96 190V195M107 191V196M135 191V196M146 190V195', p.light, 3);
    }
    s += speciesLimbs(type, p, pose);
    // A permanent scarf is part of the penguin's identity, including its baby form.
    if (type === 'penguin') s += scarf({ ...p, accent: '#DE9B97' });
    return s;
  }
  function speciesHead(type, p, expression) {
    let s = '', eyesY = 109, leftEye = 103, rightEye = 140;
    const roundEar = (x, y, r, inner = p.light) => circle(x, y, r, p.fur, rim(p)) + circle(x, y, r * .55, inner);
    const nose = (x = 121, y = 125) => path(`M${x - 6} ${y - 3}Q${x} ${y - 6} ${x + 6} ${y - 3}L${x + 2} ${y + 2}Q${x} ${y + 4} ${x - 2} ${y + 2}Z`, p.ink);
    if (type === 'penguin') {
      s += shape('M77 106Q75 68 109 64L103 56 116 62 124 54 129 64Q162 67 164 104Q173 133 149 145Q120 158 91 144Q69 136 77 106Z', p.fur, p);
      s += path('M86 105Q87 80 103 82Q116 81 121 96Q127 79 141 82Q157 82 157 106L157 126Q143 146 121 146Q96 146 83 125Z', p.light);
      s += shape('M109 122Q120 112 132 122L121 132Z', p.accent, p, 2.5);
    } else if (type === 'panda') {
      s += circle(84, 76, 19, p.dark, rim(p)) + circle(157, 76, 19, p.dark, rim(p));
      s += shape('M75 108Q73 78 104 75Q121 70 140 76Q168 78 170 108Q177 140 146 149Q120 154 94 146Q66 139 75 108Z', p.fur, p);
      s += ellipse(99, 109, 14, 19, p.dark, 'transform="rotate(25 99 109)"') + ellipse(143, 109, 14, 19, p.dark, 'transform="rotate(-25 143 109)"');
      s += ellipse(121, 132, 21, 15, p.light) + nose();
      s += line('M155 77 173 60', '#72935F', 2.5) + shape('M165 68Q161 52 177 51Q179 64 165 68Z', p.accent, p, 2);
    } else if (type === 'bear') {
      s += roundEar(83, 77, 19, p.dark) + roundEar(158, 77, 19, p.dark);
      s += shape('M77 105Q78 76 109 74Q135 71 153 84Q167 92 166 110Q176 138 148 146Q119 157 91 145Q68 137 77 105Z', p.fur, p);
      s += ellipse(121, 129, 25, 20, p.light) + nose(121, 122);
      s += shape('M97 78Q104 71 110 78L118 74 125 80', p.fur, p, 2.5);
    } else if (type === 'dog') {
      s += shape('M89 78Q65 68 61 91Q60 110 68 131Q72 141 82 130L101 87Z', p.dark, p)
        + shape('M151 77Q175 69 182 91Q185 115 173 131Q164 140 159 127L140 87Z', p.dark, p);
      s += shape('M85 90Q94 75 119 76Q151 70 162 96L166 124Q160 149 122 151Q82 150 76 130Z', p.fur, p);
      s += path('M141 81Q156 85 161 105Q157 122 144 124Q129 120 130 105Q128 91 141 81Z', p.dark);
      s += ellipse(121, 132, 29, 19, p.light) + nose(121, 125);
    } else if (type === 'deer') {
      s += line('M93 80 83 59 78 32M85 64 67 55 64 42M79 45 91 37M148 80 158 58 162 30M156 64 175 53 179 41M161 44 149 34', p.ink, 7);
      s += line('M93 80 83 59 78 32M85 64 67 55 64 42M79 45 91 37M148 80 158 58 162 30M156 64 175 53 179 41M161 44 149 34', p.dark, 3.5);
      s += shape('M100 87Q77 56 60 70Q65 92 94 96ZM142 87Q161 57 180 70Q176 91 146 97Z', p.fur, p);
      s += path('M94 88 71 74Q77 88 94 91ZM149 88 170 74Q165 87 149 92Z', p.cheek);
      s += shape('M86 101Q86 74 120 76Q155 76 156 104L153 126Q145 151 122 153Q96 153 88 130Z', p.fur, p);
      s += ellipse(121, 134, 24, 17, p.light) + circle(99, 91, 4, p.light) + circle(142, 91, 4, p.light) + nose(121, 126);
    } else if (type === 'squirrel') {
      s += shape('M82 89 77 53 85 59 91 46 108 79ZM135 79 151 46 156 59 165 54 159 92Z', p.fur, p);
      s += path('M86 78 86 64 100 82ZM145 80 155 63 155 81Z', p.dark);
      s += shape('M80 103Q77 80 105 78Q120 73 137 79Q164 82 163 107L176 119 167 123 171 135Q149 151 122 151Q95 151 71 136L76 125 66 120Z', p.fur, p);
      s += path('M75 122Q85 107 105 119L120 126 138 118Q155 109 168 124L163 132Q146 149 121 149Q92 148 77 133Z', p.light) + nose(121, 125);
      s += rounded(115, 134, 11, 10, 2, '#FFFCF5', p) + line('M120 135V143', p.dark, 1.5);
    } else if (type === 'hedgehog') {
      // The spiny hood stays recognizable above the eggshell, hat and crown.
      s += shape('M73 125 59 112 69 103 60 90 76 84 76 66 92 71 101 57 115 65 130 54 139 70 156 61 160 79 176 78 174 96 186 107 175 120 178 135 161 141Z', p.dark, p);
      s += shape('M79 113Q75 89 98 86Q113 84 121 97Q129 82 146 87Q167 92 165 118Q166 146 124 151Q85 151 78 133Z', p.light, p);
      s += path('M115 135 121 125 127 135Z', p.fur) + nose(121, 127);
      s += line('M77 94 85 99M89 77 95 86M147 78 145 87M168 106 161 112', p.fur, 3);
    } else if (type === 'raccoon') {
      s += shape('M77 93 73 65Q74 55 83 60L103 80M140 79 158 60Q169 54 169 67L164 95', p.fur, p);
      s += path('M81 81 81 67 94 82ZM149 82 161 67 161 83Z', p.dark);
      s += shape('M78 95Q92 74 122 78Q154 75 167 101L176 123 166 130Q150 149 122 150Q94 150 77 134L67 125Z', p.fur, p);
      s += path('M76 103Q91 96 104 98L120 108 138 98Q154 96 169 105L165 123Q147 132 134 122L121 116 107 124Q91 133 77 124Z', p.dark);
      s += path('M113 81 127 80 127 115 135 129 120 138 108 129 115 113Z', p.light) + ellipse(121, 133, 24, 13, p.light) + nose(121, 125);
    } else if (type === 'koala') {
      s += shape('M93 79Q84 58 65 65L58 63 56 72 46 77 50 86 45 94 52 100 53 111Q72 124 91 105Z', p.fur, p)
        + shape('M148 79Q158 58 176 65L185 63 186 73 196 78 192 87 197 95 189 102 188 113Q168 123 149 105Z', p.fur, p);
      s += ellipse(71, 89, 15, 20, p.light) + ellipse(171, 90, 15, 20, p.light);
      s += shape('M80 108Q80 80 109 76Q129 70 148 83Q165 91 163 115Q170 141 146 148Q119 155 94 146Q74 139 80 108Z', p.fur, p);
      s += ellipse(121, 137, 20, 12, p.light) + bean(121, 119, 12, 18, p.ink, p) + ellipse(117, 113, 3, 7, p.dark);
    } else if (type === 'elephant') {
      s += shape('M100 91Q79 64 59 77Q39 96 56 123Q66 141 91 133L104 113Z', p.fur, p)
        + shape('M140 91Q160 63 180 76Q201 94 186 124Q175 143 150 133L138 112Z', p.fur, p);
      s += path('M88 93Q69 76 60 90Q52 105 68 123Q78 133 92 121Z', p.cheek) + path('M153 94Q171 76 181 89Q190 105 174 123Q164 133 150 122Z', p.cheek);
      s += shape('M84 111Q80 76 109 70Q121 65 136 73Q161 80 158 112Q158 140 132 148L106 143Q83 138 84 111Z', p.fur, p);
      s += shape('M105 128Q105 145 94 145Q92 136 99 127ZM139 127Q147 136 145 145Q133 145 134 129Z', '#FFF6DD', p, 2);
      // The trunk is drawn after clothes so every stage keeps its full silhouette.
    } else if (type === 'lion') {
      s += shape('M87 70Q84 55 103 58Q113 43 125 55Q145 46 152 64Q174 61 175 79Q191 87 180 103Q190 120 175 130Q174 151 154 151Q144 169 127 157Q107 170 96 155Q76 159 71 140Q50 130 62 113Q50 95 67 84Q67 65 87 70Z', p.dark, p);
      s += roundEar(88, 86, 13, p.light) + roundEar(153, 86, 13, p.light);
      s += shape('M85 105Q85 80 120 80Q155 80 157 106Q162 138 141 148Q121 156 100 146Q80 136 85 105Z', p.fur, p);
      s += ellipse(121, 131, 25, 18, p.light) + nose(121, 123);
      s += line('M71 91 79 96M166 84 161 92M74 134 84 128M160 139 155 132M112 61 114 71', p.fur, 3);
    } else if (type === 'tiger') {
      s += roundEar(84, 78, 17, p.ink) + roundEar(157, 78, 17, p.ink);
      s += shape('M77 104Q78 78 106 76Q122 71 141 77Q166 84 166 109Q176 136 149 147Q121 157 92 146Q69 137 77 104Z', p.fur, p);
      s += path('M111 77 115 97 121 103 127 96 132 76 124 80 121 93 118 79ZM80 97 96 105 79 108ZM76 115 94 121 80 125ZM160 95 146 104 165 109ZM166 115 148 121 162 126Z', p.ink);
      s += ellipse(121, 132, 27, 19, p.light) + nose(121, 124);
      s += line('M86 137 72 140M154 137 168 140', p.ink, 2.2);
    } else if (type === 'dragon') {
      s += shape('M95 82Q74 67 82 43Q91 60 105 69ZM138 70Q153 60 159 43Q169 64 150 82Z', p.light, p);
      s += shape('M92 92 66 77 68 101 85 111ZM148 92 176 77 174 102 157 112Z', p.fur, p);
      s += shape('M82 111Q79 79 110 73L119 65 128 73Q159 74 161 108L169 125Q170 145 144 150Q117 160 91 146Q74 137 82 111Z', p.fur, p);
      s += shape('M89 126Q94 111 120 115Q149 110 156 126Q166 149 121 151Q78 149 89 126Z', p.light, p, 2.5);
      s += circle(107, 126, 3, p.dark) + circle(138, 126, 3, p.dark);
      s += shape('M116 75 122 62 130 76 124 87Z', p.accent, p, 2);
      s += line('M101 138Q119 147 142 137', p.ink, 2.2) + path('M107 140 111 147 115 142ZM133 141 138 147 141 138Z', '#FFFFFF');
    } else if (type === 'unicorn') {
      s += shape('M87 95Q75 67 85 52Q101 60 106 80ZM137 81Q145 59 158 56Q169 79 150 99Z', p.fur, p);
      s += path('M88 83 88 65 99 85ZM145 85 156 68 155 86Z', p.cheek);
      s += shape('M88 104Q84 78 108 72Q133 64 149 84Q160 105 150 132Q144 152 121 158Q96 152 88 133Z', p.fur, p);
      s += shape('M107 74 121 27 133 75Z', p.accent, p) + line('M111 61 130 66M115 49 126 54M118 38 124 42', p.light, 2.5);
      s += shape('M136 76Q156 80 157 105Q146 112 153 127L165 133Q146 145 138 127Q134 110 142 104Q149 92 136 76Z', '#D1B6E5', p, 2.5);
      s += line('M145 86Q154 101 146 111Q143 126 156 133', '#AFD4D2', 5);
      s += ellipse(121, 138, 27, 18, p.light) + circle(110, 137, 2.6, p.dark) + circle(132, 137, 2.6, p.dark);
      leftEye = 103; rightEye = 135; eyesY = 111;
    } else if (type === 'otter') {
      s += roundEar(83, 91, 12, p.dark) + roundEar(158, 91, 12, p.dark);
      s += shape('M77 107Q77 83 105 80Q132 73 152 87Q168 97 165 118Q174 143 146 153Q120 160 92 150Q68 141 77 107Z', p.fur, p);
      s += ellipse(120, 135, 35, 19, p.light) + ellipse(109, 129, 17, 12, '#FFF9EC') + ellipse(133, 129, 17, 12, '#FFF9EC') + nose(121, 122);
      s += line('M95 130 73 127M96 137 75 143M147 130 169 126M146 137 166 144', p.ink, 2.1);
    } else if (type === 'seal') {
      s += shape('M67 111Q70 84 105 79Q136 73 159 91Q178 105 174 126Q170 150 140 155Q102 159 79 143Q61 132 67 111Z', p.fur, p);
      s += ellipse(119, 132, 34, 20, p.light) + nose(120, 122);
      s += line('M90 128 65 122M91 135 61 136M94 141 70 149M149 127 173 120M151 134 180 134M147 141 173 148', p.ink, 2.1);
      s += circle(84, 115, 3.2, p.dark) + circle(159, 115, 3.2, p.dark);
      eyesY = 111;
    }
    if (expression === 'sleepy') s += line(`M${leftEye - 6} ${eyesY}Q${leftEye} ${eyesY + 7} ${leftEye + 6} ${eyesY}M${rightEye - 6} ${eyesY}Q${rightEye} ${eyesY + 7} ${rightEye + 6} ${eyesY}`, type === 'panda' || type === 'raccoon' ? p.light : p.ink, 3.5);
    else {
      // White eye rims keep panda / raccoon eyes legible within their masks.
      if (type === 'panda' || type === 'raccoon') s += ellipse(leftEye, eyesY, 7.5, 10, '#FFFDF5') + ellipse(rightEye, eyesY, 7.5, 10, '#FFFDF5');
      s += ellipse(leftEye, eyesY, 5, 7.5, p.ink) + ellipse(rightEye, eyesY, 5, 7.5, p.ink)
        + circle(leftEye + 1.7, eyesY - 2.5, 2.1, '#FFFFFF') + circle(rightEye + 1.7, eyesY - 2.5, 2.1, '#FFFFFF');
    }
    if (type !== 'elephant') s += ellipse(87, 126, 7, 4, p.cheek, 'opacity=".8"') + ellipse(154, 126, 7, 4, p.cheek, 'opacity=".8"');
    if (!['dragon', 'elephant', 'squirrel'].includes(type)) {
      s += line(type === 'penguin' ? 'M114 138Q121 143 128 138' : type === 'unicorn' ? 'M112 146Q121 151 130 145' : type === 'koala' ? 'M115 140Q121 144 127 140' : 'M121 129V132Q114 140 109 133M121 132Q127 140 133 133', p.ink, 2.2);
    }
    return s;
  }

  function headband(p) {
    return path('M77 93Q118 80 163 94L165 102Q119 91 76 102Z', p.accent, `stroke="${p.ink}" stroke-width="2.5" ${outline}`) + path('M161 97 185 93 176 105 188 111 163 106Z', p.accent, `stroke="${p.ink}" stroke-width="2.5" ${outline}`) + star(120, 93, .55, '#FFFCF1');
  }
  // Adventure companions are additive. The original twenty drawing paths above,
  // their palettes, and their scene composition remain byte-for-byte compatible.
  const adventureIds = Object.freeze(['robot', 'rover', 'mechcrab', 'mechbeetle', 'mechdragonfly', 'rex', 'raptor', 'triceratops', 'stegosaurus', 'ankylosaurus', 'pteranodon', 'mammoth', 'rhino', 'gorilla', 'wolf', 'boar', 'eagle', 'shark', 'orca', 'phoenix']);
  const isAdventureSpecies = type => adventureIds.includes(type);
  function joint(x, y, p, r = 7) {
    return circle(x, y, r, p.dark, rim(p)) + circle(x, y, r * .42, p.light);
  }
  function adventureArms(p, pose, mechanical = false, thick = false) {
    const raised = pose === 'power', spread = pose === 'fly', moving = pose === 'run';
    const lx = raised ? 53 : spread ? 51 : moving ? 65 : 83;
    const ly = raised ? 125 : spread ? 149 : moving ? 147 : 168;
    const rx = raised ? 188 : spread ? 190 : moving ? 172 : 163;
    const ry = raised ? 125 : spread ? 146 : moving ? 123 : pose === 'travel' || pose === 'guard' ? 142 : 168;
    const width = thick ? 27 : mechanical ? 15 : 16;
    let s = line(`M94 142Q76 153 ${lx} ${ly}M147 142Q163 154 ${rx} ${ry}`, p.ink, width + 5)
      + line(`M94 142Q76 153 ${lx} ${ly}M147 142Q163 154 ${rx} ${ry}`, p.fur, width);
    if (mechanical) s += joint(88, 145, p) + joint(154, 145, p)
      + rounded(lx - 10, ly - 8, 20, 17, 5, p.light, p) + rounded(rx - 10, ry - 8, 20, 17, 5, p.light, p);
    else s += bean(lx, ly, thick ? 14 : 9, thick ? 13 : 9, thick ? p.dark : p.fur, p)
      + bean(rx, ry, thick ? 14 : 9, thick ? 13 : 9, thick ? p.dark : p.fur, p);
    return s;
  }
  function wingPair(p, pose, membrane = false, fiery = false) {
    const high = pose === 'power' || pose === 'fly';
    const left = high ? 'M99 141Q75 101 29 99L41 119 29 128 48 131 42 145 65 143 63 155 101 163Z' : 'M98 139Q68 133 47 154L33 175 53 171 51 184 68 175 69 188 99 163Z';
    const right = high ? 'M141 141Q170 99 213 98L201 119 214 128 195 132 199 145 178 143 177 155 140 163Z' : 'M143 139Q172 133 196 154L210 175 189 171 191 184 173 175 171 188 140 163Z';
    let s = shape(left, membrane ? p.accent : fiery ? p.accent : p.dark, p)
      + shape(right, membrane ? p.accent : fiery ? p.accent : p.dark, p);
    if (membrane) s += line(high ? 'M35 106 99 152M42 129 99 152M208 106 142 152M199 131 142 152' : 'M48 153 97 152M53 173 97 152M193 153 143 152M187 173 143 152', p.fur, 3);
    else s += line(high ? 'M47 113 93 149M49 132 84 146M194 113 148 149M191 133 159 148' : 'M65 149 91 150M53 167 87 157M175 150 149 151M189 167 155 158', p.light, 4);
    return s;
  }
  function adventureBody(type, p, pose) {
    let s = '', upright = pose === 'power' || pose === 'fly';
    if (type === 'robot') {
      s += rounded(91, 170, 22, 28, 6, p.dark, p) + rounded(129, 170, 22, 28, 6, p.dark, p);
      s += rounded(84, 190, 33, 13, 5, p.fur, p) + rounded(124, 190, 33, 13, 5, p.fur, p);
      s += rounded(82, 128, 78, 57, 15, p.fur, p) + rounded(98, 144, 46, 26, 7, p.light, p);
      s += circle(121, 157, 9, p.accent, rim(p)) + star(121, 157, .44, p.light);
      s += adventureArms(p, pose, true) + line('M101 180H141', p.dark, 3);
    } else if (type === 'rover') {
      s += rounded(53, 166, 137, 37, 18, p.dark, p);
      for (const x of [72, 102, 134, 168]) s += joint(x, 184, p, 12);
      s += line('M65 169H176M65 199H176', p.light, 2);
      s += shape('M74 139 91 128H145L171 146 179 175H62Z', p.fur, p);
      s += rounded(80, 150, 82, 24, 6, p.light, p) + line('M95 155V169M108 155V169M121 155V169M134 155V169M147 155V169', p.dark, 3);
      s += circle(68, 158, 5, p.accent, rim(p)) + circle(174, 158, 5, p.accent, rim(p));
      s += line(`M159 139 185 ${upright ? 106 : 130}`, p.ink, 6) + circle(185, upright ? 106 : 130, 6, p.accent, rim(p));
      if (pose === 'power') s += adventureArms(p, pose, true);
    } else if (type === 'mechcrab') {
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) s += line(`M${120 + side * 29} ${155 + i * 9} ${120 + side * (58 + i * 4)} ${153 + i * 12} ${120 + side * (67 + i * 3)} ${167 + i * 12}`, p.ink, 9)
        + line(`M${120 + side * 29} ${155 + i * 9} ${120 + side * (58 + i * 4)} ${153 + i * 12} ${120 + side * (67 + i * 3)} ${167 + i * 12}`, p.fur, 5);
      s += shape('M77 139Q119 120 161 140L169 170Q151 189 120 191Q88 189 70 169Z', p.fur, p);
      s += shape('M91 147 120 137 150 147 145 169 120 181 96 169Z', p.light, p) + joint(120, 158, p, 10);
      const cy = upright ? 121 : 147;
      s += line(`M81 143 56 ${cy + 12}M160 143 185 ${cy + 12}`, p.ink, 9);
      s += shape(`M56 ${cy + 18}Q32 ${cy + 21} 29 ${cy - 3}L41 ${cy - 15} 44 ${cy + 2} 54 ${cy - 1} 58 ${cy - 19}Q78 ${cy + 1} 56 ${cy + 18}Z`, p.fur, p)
        + shape(`M185 ${cy + 18}Q208 ${cy + 21} 212 ${cy - 3}L200 ${cy - 15} 197 ${cy + 2} 187 ${cy - 1} 183 ${cy - 19}Q163 ${cy + 1} 185 ${cy + 18}Z`, p.fur, p);
    } else if (type === 'mechbeetle') {
      for (let i = 0; i < 3; i++) s += line(`M88 ${139 + i * 17} 66 ${148 + i * 17} 58 ${157 + i * 15}M154 ${139 + i * 17} 176 ${148 + i * 17} 184 ${157 + i * 15}`, p.ink, 6);
      s += shape('M93 122Q120 113 149 124Q171 151 156 182Q143 202 120 204Q94 199 82 180Q69 150 93 122Z', p.dark, p);
      s += shape('M93 128Q109 117 120 125V194Q92 189 83 164Q81 143 93 128Z', p.fur, p)
        + shape('M122 125Q142 117 153 137Q169 164 145 189L122 196Z', p.fur, p);
      s += line('M93 141 103 135M141 135 153 145M91 175 98 183M148 178 143 185', p.accent, 5);
      s += joint(120, 137, p, 7) + (upright ? adventureArms(p, pose, true) : '');
    } else if (type === 'mechdragonfly') {
      s += shape('M108 130Q77 81 41 112Q40 140 110 154ZM132 130Q168 83 200 111Q202 139 131 153Z', p.light, p)
        + shape('M108 151Q53 131 40 162Q56 186 111 169ZM132 150Q188 132 202 160Q187 185 132 169Z', p.light, p);
      s += line('M48 119 105 147M192 119 136 146M48 164 105 159M191 163 138 159', p.accent, 3);
      s += shape('M106 137Q120 127 134 138L135 173 127 201 119 210 111 199 105 172Z', p.fur, p);
      s += line('M109 163H132M109 177H132M114 190H128M118 200H124', p.dark, 4);
      s += circle(120, 147, 8, p.accent, rim(p));
      for (const x of [70, 171]) s += circle(x, 131, 9, p.accent, rim(p)) + line(`M${x - 6} 131H${x + 6}M${x} 125V137`, p.ink, 2);
      if (pose === 'power') s += adventureArms(p, pose, true);
    } else if (['rex', 'raptor', 'stegosaurus', 'ankylosaurus', 'triceratops'].includes(type)) {
      const tailShape = type === 'raptor' ? 'M142 165Q179 173 208 130Q206 169 179 188L148 188Z'
        : type === 'ankylosaurus' ? 'M143 175Q176 188 194 170L202 179Q181 206 141 193Z'
        : type === 'stegosaurus' ? 'M145 170Q178 179 200 160L208 169Q184 197 147 188Z'
        : 'M145 170Q181 183 197 150Q208 179 181 193L146 191Z';
      s += shape(tailShape, p.fur, p);
      if (type === 'ankylosaurus') s += shape('M188 174Q181 155 195 151Q206 150 210 161Q225 157 226 170Q226 185 205 184Z', p.dark, p);
      if (type === 'stegosaurus') {
        s += shape('M153 138 160 115 177 129 170 151 183 141 196 155 185 174Z', p.accent, p);
        s += shape('M193 168 202 146 208 165 220 156 212 177Z', p.light, p, 2.5);
      }
      s += feet(p, pose);
      const torso = type === 'raptor' ? 'M107 123Q88 144 88 170Q83 197 119 198Q151 199 154 175L140 130Z'
        : type === 'ankylosaurus' ? 'M87 128Q65 148 75 180Q82 197 120 196Q163 196 169 172Q171 143 149 125Z'
        : 'M100 124Q78 143 80 171Q80 198 121 198Q159 197 161 174Q163 146 141 124Z';
      s += shape(torso, p.fur, p) + ellipse(119, 167, type === 'raptor' ? 22 : 27, 26, p.light);
      if (type === 'ankylosaurus') {
        s += shape('M84 137Q120 121 156 139L166 160 154 174 144 162 129 172 117 158 100 172 89 160 75 169Z', p.dark, p);
        for (const [x, y] of [[91,145],[111,140],[134,141],[153,148]]) s += shape(`M${x - 5} ${y + 4} ${x} ${y - 9} ${x + 6} ${y + 4}Z`, p.accent, p, 2);
      } else s += line('M106 152H132M101 165H139M108 180H134', p.dark, 2);
      if (type === 'rex' || type === 'raptor') {
        if (pose === 'power') s += adventureArms(p, pose);
        else {
          s += shape(type === 'rex' ? 'M91 142 78 151 81 165 95 160ZM148 141 161 151 158 164 145 157Z' : 'M94 140 77 151 70 170 82 173 101 152ZM144 140 167 150 174 165 163 172 141 153Z', p.fur, p);
          s += line('M82 159 89 163M151 156 158 160', p.light, 2.5);
        }
        if (type === 'raptor') s += shape('M96 195 89 207 102 202ZM143 195 151 207 138 202Z', p.dark, p, 2);
      } else s += adventureArms(p, pose);
    } else if (type === 'pteranodon' || type === 'eagle' || type === 'phoenix') {
      if (type === 'phoenix') s += shape('M101 165Q73 193 64 212Q93 211 107 190Q104 209 121 223Q139 208 133 187Q152 211 183 216Q174 189 145 163Z', p.dark, p)
        + shape('M107 166Q89 190 89 205L117 180 121 213 129 180 160 204Q157 181 137 164Z', p.accent, p);
      if (type === 'eagle') s += shape('M103 174 91 205 105 201 116 213 125 202 140 207 135 174Z', p.dark, p);
      s += wingPair(p, pose, type === 'pteranodon', type === 'phoenix');
      s += shape('M103 124Q83 141 88 170Q94 193 119 196Q146 193 152 169Q156 140 137 123Z', p.fur, p);
      s += shape('M104 133Q121 142 137 131L137 169Q122 185 102 169Z', p.light, p, 2);
      s += shape('M102 184 94 199 110 194 117 198 117 183ZM130 183 126 198 138 194 150 199 141 184Z', p.accent, p);
      if (type === 'phoenix') s += shape('M106 148 119 139 132 151 120 169Z', p.accent, p) + line('M120 144V162', p.dark, 2);
    } else if (type === 'shark' || type === 'orca') {
      s += shape(type === 'shark' ? 'M144 160Q174 162 191 180L213 160 207 190 216 203 196 199Q170 199 146 183Z' : 'M144 166Q176 169 190 183Q209 171 215 181L206 193 215 202Q201 210 188 199Q162 201 145 184Z', p.dark, p);
      s += shape(type === 'shark' ? 'M133 131 155 103 155 137Z' : 'M128 135Q137 103 151 107L152 141Z', p.dark, p);
      s += shape('M99 122Q79 138 80 165Q81 192 117 198Q150 199 162 180Q159 150 143 124Z', p.fur, p)
        + shape('M112 136Q89 151 98 181Q112 199 142 188Q147 164 133 139Z', p.light, p, 2);
      s += shape(pose === 'power' ? 'M94 140Q78 127 56 116L43 125 65 148 97 162ZM147 140Q165 125 185 116L199 125 178 148 145 163Z' : upright ? 'M92 136 45 144 58 161 97 163ZM147 138 194 138 183 163 145 165Z' : 'M91 139Q66 150 58 176Q75 182 99 162ZM148 139Q174 153 182 175Q166 186 145 162Z', p.fur, p);
      if (type === 'shark') s += line('M91 136 86 148M97 138 93 151M103 139 100 153', p.dark, 2.3);
    } else {
      if (type === 'wolf') s += shape('M144 174Q170 194 200 168L205 143 186 150 190 132Q172 142 163 157L143 157Z', p.fur, p) + path('M183 159 200 168 205 143 186 150 190 132 178 140Z', p.light);
      if (type === 'boar') s += line('M151 180Q190 194 190 173Q189 163 179 169Q174 178 186 179', p.ink, 5);
      if (type === 'mammoth') s += shape('M96 140 74 148 76 177 65 191 83 189 87 207 101 196 120 210 138 196 151 204 156 188 171 191 164 174 166 143Z', p.dark, p);
      s += feet(p, pose);
      s += shape(type === 'gorilla' ? 'M87 121Q64 149 78 178Q88 201 120 201Q155 201 165 177Q178 148 153 121Z' : type === 'rhino' ? 'M90 126Q69 147 80 178Q90 197 121 197Q158 198 164 175Q170 144 145 126Z' : 'M99 125Q78 140 82 171Q86 198 120 199Q155 198 160 174Q166 144 142 125Z', p.fur, p);
      s += ellipse(120, type === 'gorilla' ? 154 : 166, type === 'gorilla' ? 33 : 25, type === 'gorilla' ? 28 : 25, p.light);
      s += adventureArms(p, pose, false, type === 'gorilla');
      if (type === 'rhino') s += line('M83 151 97 154M145 154 163 150M98 184H112M133 184H147', p.dark, 3);
      if (type === 'wolf') s += shape('M91 137 105 145 120 136 135 145 150 137 142 162 132 158 121 174 110 159 100 162Z', p.light, p, 2);
      if (type === 'boar') s += line('M103 169 107 176M135 168 133 177', p.dark, 3);
      if (type === 'mammoth') s += line('M93 177 96 189M105 181 108 194M141 177 139 191', p.dark, 3);
    }
    return s;
  }

  function adventureHead(type, p, expression) {
    let s = '', lx = 102, rx = 141, ey = 108, mouth = true;
    const ivory = '#FFF1CF';
    const ear = (x, y, size = 14) => bean(x, y, size, size + 3, p.fur, p) + ellipse(x, y, size * .5, size * .6, p.light);
    if (type === 'robot') {
      s += line('M120 68V48', p.ink, 4) + joint(120, 47, p, 7);
      s += rounded(65, 89, 17, 28, 7, p.dark, p) + rounded(158, 89, 17, 28, 7, p.dark, p);
      s += rounded(76, 69, 90, 78, 22, p.fur, p) + rounded(86, 87, 70, 44, 14, p.dark, p);
      s += line('M108 137H133', p.light, 3) + circle(84, 79, 3, p.accent) + circle(157, 137, 3, p.accent);
      if (expression === 'sleepy') s += line('M94 106H108M132 106H146', p.light, 3.5);
      else s += rounded(95, 99, 13, 15, 5, p.light, {...p, ink:p.light}) + rounded(133, 99, 13, 15, 5, p.light, {...p, ink:p.light});
      s += line('M111 120Q121 126 132 120', p.accent, 2.5); return s;
    } else if (type === 'rover') {
      s += shape('M85 79 99 67H143L159 80 168 128 153 145H87L72 126Z', p.fur, p);
      s += shape('M94 83H145L154 115H85Z', p.dark, p) + line('M95 91H142', p.light, 3);
      s += rounded(95, 122, 52, 18, 5, p.light, p) + line('M104 128V134M114 128V134M125 128V134M136 128V134', p.dark, 2.5);
      s += rounded(81, 69, 20, 8, 3, p.accent, p) + rounded(142, 69, 20, 8, 3, p.accent, p); mouth = false; ey = 106;
    } else if (type === 'mechcrab') {
      s += line('M97 99 91 77M142 99 151 77', p.ink, 7) + circle(91, 73, 12, p.light, rim(p)) + circle(151, 73, 12, p.light, rim(p));
      s += shape('M78 112 88 94 111 89 124 96 144 91 163 102 168 126 155 145H89L70 126Z', p.fur, p);
      s += shape('M83 111 101 99 119 108 140 101 157 113 149 132 119 139 88 130Z', p.light, p, 2);
      s += joint(79, 118, p, 5) + joint(160, 118, p, 5); lx = 91; rx = 151; ey = 73;
      s += line('M108 122Q121 132 134 121', p.ink, 2.5); mouth = false;
    } else if (type === 'mechbeetle') {
      s += shape('M95 89Q69 64 86 38L94 51 100 43 99 62 111 78ZM133 79 140 61 139 43 145 51 155 38Q170 65 145 90Z', p.accent, p);
      s += shape('M81 101 91 82 117 77 148 83 161 101 157 131 139 146 100 145 79 126Z', p.dark, p);
      s += shape('M92 97 117 89 148 99 149 118 134 132H104L90 118Z', p.light, p, 2);
      s += shape('M115 80 121 72 128 81 123 92Z', p.accent, p) + line('M109 137H132', p.accent, 3); ey = 108;
    } else if (type === 'mechdragonfly') {
      s += line('M103 85 94 62M139 85 149 61', p.ink, 3) + circle(94, 61, 4, p.accent) + circle(149, 60, 4, p.accent);
      s += shape('M94 97Q119 81 146 97L151 123Q146 142 121 147Q94 141 88 124Z', p.fur, p);
      s += bean(92, 103, 22, 23, p.light, p) + bean(149, 103, 22, 23, p.light, p);
      s += line('M118 112H125', p.dark, 4) + rounded(109, 128, 25, 10, 4, p.accent, p); lx = 93; rx = 150; ey = 103; mouth = false;
    } else if (type === 'rex') {
      s += shape('M82 102Q73 75 103 65Q130 55 157 77L163 99 180 106 177 131Q163 151 124 148L83 137Z', p.fur, p);
      s += shape('M87 111Q124 122 173 111L173 132Q143 150 101 139Z', p.light, p, 2.3);
      s += path('M95 116 99 124 105 118ZM123 119 128 127 133 119ZM151 117 157 124 162 115Z', ivory);
      s += circle(157, 104, 2.7, p.dark) + circle(168, 105, 2.5, p.dark) + line('M94 89 106 86M132 87 144 91', p.dark, 3); lx = 100; rx = 139; ey = 98;
      s += line('M105 136Q129 143 153 135', p.ink, 2.2); mouth = false;
    } else if (type === 'raptor') {
      s += shape('M90 85 81 57 102 72 109 53 120 71 133 58 140 83Z', p.accent, p);
      s += shape('M80 109Q79 80 109 76Q135 71 150 91L173 103Q184 112 175 125L149 135Q115 154 89 137Z', p.fur, p);
      s += shape('M93 121Q124 128 174 113L173 124 145 138Q111 147 94 134Z', p.light, p, 2);
      s += line('M83 104 96 97M87 117 96 110', p.dark, 5) + circle(169, 110, 2.7, p.dark); ey = 104; lx = 110; rx = 147;
      s += line('M112 133Q135 137 152 129', p.ink, 2.3); mouth = false;
    } else if (type === 'triceratops') {
      s += shape('M79 111 61 95 66 77 83 75 88 59 104 67 119 51 137 66 153 59 160 77 177 78 181 98 163 116Z', p.dark, p);
      s += shape('M83 103 74 89 86 83 96 73 111 80 123 66 137 80 153 72 157 90 168 96 155 113Z', p.accent, p, 2);
      s += shape('M79 110Q79 84 118 85Q155 82 164 109Q174 137 144 149Q105 160 85 138Z', p.fur, p);
      s += shape('M87 103 84 67Q97 77 104 103ZM139 102 155 67 154 108Z', ivory, p, 2.5);
      s += ellipse(121, 128, 28, 19, p.light) + shape('M116 126 122 103 132 128Z', ivory, p, 2); ey = 114;
    } else if (type === 'stegosaurus') {
      s += shape('M87 102 67 77 78 61 96 79 106 57 122 48 134 72 151 61 166 75 154 98Z', p.accent, p);
      s += shape('M80 107Q78 81 111 82Q142 75 159 101Q181 118 163 139Q143 154 111 148Q76 148 76 125Z', p.fur, p);
      s += ellipse(125, 130, 33, 17, p.light) + circle(113, 127, 2.3, p.dark) + circle(137, 127, 2.3, p.dark);
      s += line('M85 97 93 98M153 95 160 96', p.dark, 3); lx = 101; rx = 145; ey = 110;
    } else if (type === 'ankylosaurus') {
      s += shape('M76 110 60 100 71 85 87 87 96 75 121 71 147 79 157 90 174 88 182 104 163 115Z', p.dark, p);
      s += shape('M78 107Q86 87 118 85Q150 85 163 105L169 128Q159 149 123 151Q88 149 73 131Z', p.fur, p);
      for (const [x,y] of [[87,96],[108,89],[132,89],[154,99]]) s += shape(`M${x-6} ${y+4} ${x} ${y-8} ${x+6} ${y+4}Z`, p.light, p, 2);
      s += ellipse(122, 132, 29, 15, p.light); lx = 100; rx = 146; ey = 115;
    } else if (type === 'pteranodon') {
      s += shape('M106 87 142 44 145 86Z', p.accent, p);
      s += shape('M81 113Q78 78 111 76Q143 69 159 96L153 133Q140 151 111 145Q78 140 81 113Z', p.fur, p);
      s += shape('M112 116 173 124 124 140 106 130Z', p.accent, p) + line('M117 126 164 125', p.ink, 2); lx = 99; rx = 141; ey = 104; mouth = false;
    } else if (type === 'mammoth') {
      s += ear(77, 104, 24) + ear(164, 104, 24);
      s += shape('M77 107Q75 73 110 72L123 64 132 74Q165 75 168 106L174 126 160 143 149 139 135 154 120 146 107 154 93 143 78 146 68 128Z', p.fur, p);
      s += shape('M94 125Q82 142 75 126Q74 146 89 149Q104 147 105 130ZM142 126Q157 145 166 123Q166 147 151 150Q137 148 135 130Z', ivory, p, 2.5);
      s += path('M90 83 107 65 110 80 126 66 126 85 140 73 143 91Q114 84 90 94Z', p.dark);
      s += shape('M110 119 130 119 131 145Q136 158 145 145Q153 139 154 149Q149 168 132 164Q114 164 112 144Z', p.fur, p);
      s += line('M114 136H129M117 146 130 147', p.dark, 2); mouth = false; ey = 108; lx = 99; rx = 145;
    } else if (type === 'rhino') {
      s += shape('M87 91Q65 74 77 61Q94 59 103 86ZM137 87Q145 62 161 63Q174 77 151 96Z', p.fur, p);
      s += shape('M78 105Q80 77 115 78Q149 77 161 107Q182 123 162 141Q139 157 99 144Q73 139 78 105Z', p.fur, p);
      s += shape('M94 117Q124 102 166 117L168 136Q136 152 102 138Z', p.light, p, 2);
      s += shape('M127 118Q134 95 144 84Q138 106 151 120Z', ivory, p, 2.5) + shape('M106 115 113 99 120 116Z', ivory, p, 2);
      s += circle(156, 127, 3, p.dark); lx = 98; rx = 149; ey = 104; mouth = false;
      s += line('M109 136Q127 142 147 136', p.ink, 2.3);
    } else if (type === 'gorilla') {
      s += ear(77, 110, 14) + ear(166, 110, 14);
      s += shape('M76 111Q72 77 98 69L110 64 121 68 133 62 147 72Q169 82 166 113L172 133 156 146 141 144 125 153 106 145 90 150 73 134Z', p.fur, p);
      s += shape('M87 100Q94 84 111 91L121 95 133 90Q151 85 157 103L150 120Q157 138 140 144H105Q84 140 92 121Z', p.light, p, 2.5);
      s += ellipse(121, 125, 23, 14, p.dark) + ellipse(114, 123, 4, 3, p.ink) + ellipse(129, 123, 4, 3, p.ink);
      s += line('M96 99 108 97M134 97 146 99M112 139H131', p.dark, 3); ey=109; mouth=false;
    } else if (type === 'wolf') {
      s += shape('M80 98 72 48 104 74 120 68 139 74 169 47 162 103 176 119 164 122 174 136 153 137 143 153 120 146 100 155 87 141 68 141 76 125 64 120Z', p.fur, p);
      s += path('M82 81 81 60 99 83ZM145 82 160 60 158 86Z', p.dark);
      s += shape('M78 119 101 112 120 125 141 113 165 120 151 137 122 151 92 138Z', p.light, p, 2);
      s += path('M114 121 127 121 121 130Z', p.ink) + line('M94 96 108 99M133 99 148 95', p.dark, 3); ey=108;
    } else if (type === 'boar') {
      s += shape('M86 95 68 71Q79 59 103 86ZM142 86Q164 61 174 77L154 103Z', p.dark, p);
      s += shape('M77 109Q78 79 108 77L108 65 120 73 128 61 135 78Q166 83 166 112Q178 139 151 148Q117 159 88 142Q70 131 77 109Z', p.fur, p);
      s += shape('M88 127Q76 126 78 113Q69 137 90 141ZM151 127Q165 126 165 111Q178 138 151 141Z', ivory, p, 2.3);
      s += bean(121, 130, 27, 19, p.light, p) + ellipse(112,130,4,6,p.dark) + ellipse(131,130,4,6,p.dark);
      s += line('M112 147H130',p.ink,2); mouth=false; ey=107;
    } else if (type === 'eagle') {
      s += shape('M77 108Q75 81 104 74L118 66 126 76 145 71 151 83Q165 91 165 112L173 126 160 132 165 143 148 142 139 156 123 145 105 154 92 142 77 144 82 129 69 124Z', p.light, p);
      s += shape('M112 117Q126 107 139 119L137 133 129 144 123 130 111 128Z',p.accent,p,2.5);
      s += line('M88 95 108 101M133 101 154 94',p.dark,3.5); mouth=false; ey=109;
    } else if (type === 'shark') {
      s += shape('M83 111Q88 85 109 81L132 56 141 85Q156 87 167 103L187 116 173 136Q149 152 119 148Q92 151 78 134Z',p.fur,p);
      s += shape('M87 124Q122 132 176 116L167 136Q137 153 103 140Z',p.light,p,2);
      s += path('M101 129 107 138 112 131ZM125 129 131 138 137 127ZM148 124 154 131 160 121Z',ivory);
      s += line('M113 141Q138 147 159 136',p.ink,2); lx=104;rx=151;ey=110;mouth=false;
    } else if (type === 'orca') {
      s += shape('M78 109Q76 74 107 68Q143 59 162 88Q169 99 168 111L177 124Q176 144 143 152Q107 159 84 140Q73 129 78 109Z',p.fur,p);
      s += ellipse(94,103,14,8,p.light,'transform="rotate(-28 94 103)"') + ellipse(151,102,13,8,p.light,'transform="rotate(28 151 102)"');
      s += shape('M89 126Q120 137 167 123L163 140Q136 158 104 143Z',p.light,p,2);
      s += line('M108 139Q128 147 147 136',p.ink,2.3); lx=104;rx=143;ey=116;mouth=false;
    } else if (type === 'phoenix') {
      s += shape('M92 93Q72 73 92 55L106 70Q99 41 121 34Q138 49 129 70Q147 45 158 60Q166 79 146 96Z',p.accent,p);
      s += shape('M81 108Q77 80 110 78Q144 75 159 98L174 113 162 123 167 138 146 137 138 151 120 143 102 150 95 138 76 139 82 122 70 113Z',p.fur,p);
      s += path('M85 99Q103 86 120 106Q139 86 158 98L153 121 141 133 120 140 99 131 88 119Z',p.light);
      s += shape('M112 118 121 110 133 119 122 132Z',p.accent,p,2) + line('M105 139 120 146 136 139',p.dark,2);mouth=false;ey=108;
    }
    if (expression === 'sleepy') s += line(`M${lx-6} ${ey}Q${lx} ${ey+6} ${lx+6} ${ey}M${rx-6} ${ey}Q${rx} ${ey+6} ${rx+6} ${ey}`,p.ink,3.2);
    else s += ellipse(lx,ey,4.7,7,p.ink) + ellipse(rx,ey,4.7,7,p.ink) + circle(lx+1.5,ey-2.5,1.8,'#FFFFFF') + circle(rx+1.5,ey-2.5,1.8,'#FFFFFF');
    if (!['mechcrab','mechbeetle','rover','orca'].includes(type)) s += ellipse(lx-10,ey+14,6,3.5,p.cheek,'opacity=".75"') + ellipse(rx+10,ey+14,6,3.5,p.cheek,'opacity=".75"');
    if (mouth) s += line('M115 136Q122 142 129 136',p.ink,2.3);
    return s;
  }

  function scarf(p) {
    return shape('M94 139Q120 149 146 140L146 152Q119 161 94 151Z', p.accent, p, 2.5) + shape('M141 148Q161 150 165 163L151 161 155 173Q142 165 135 154Z', p.accent, p, 2.5);
  }
  function dumbbell(x, y, p) {
    return `<g transform="translate(${x} ${y}) rotate(${x < 120 ? -8 : 8})">${line('M-17 0H17', p.ink, 7)}${rounded(-25, -12, 11, 24, 4, p.accent, p)}${rounded(14, -12, 11, 24, 4, p.accent, p)}${line('M-20 -7V3M19 -7V3', '#FFFFFF', 2)}</g>`;
  }

  function scene(type, stage, p) {
    let behind = '', pet = '', front = '';
    if (stage === 1) {
      behind = ground(p, 63) + sparkle(57, 115, .9, p.accent) + sparkle(181, 95, .65, p.dark) + circle(181, 146, 3, p.cheek);
      pet = `<g transform="translate(11 34) scale(.9)">${body(type, p, 'baby')}${head(type, p, 'sleepy')}</g>`;
      front = shape('M65 158 81 167 95 153 110 168 126 153 141 168 158 154 175 163Q177 207 122 214Q68 210 65 158Z', '#FFFCF4', p);
      front += path('M69 185Q122 200 172 183Q164 210 122 214Q83 211 69 185Z', p.light);
      front += ellipse(93, 185, 7, 5, p.cheek) + ellipse(145, 195, 9, 5, p.accent) + circle(125, 177, 4, p.fur);
      front += shape('M164 64 173 48 185 55 193 45 201 69Q187 77 164 64Z', '#FFFCF4', p, 2.5);
      front += shape('M44 202 55 192 67 207Z', p.light, p, 2.5);
    } else if (stage === 2) {
      behind = ground(p) + line('M40 164H62M33 179H56M44 194H61', p.accent, 5) + sparkle(187, 70, .9, p.accent);
      pet = `<g transform="rotate(-9 120 150)">${body(type, p, 'run')}${head(type, p)}${headband(p)}${scarf(p)}</g>`;
      front = circle(184, 194, 18, p.light, `stroke="${p.ink}" stroke-width="3"`) + line('M174 180Q190 192 172 207M193 179Q180 197 196 207M167 194H200', p.accent, 2.5);
      front += circle(45, 129, 3, p.cheek);
    } else if (stage === 3) {
      behind = ground(p, 88) + path('M43 200Q60 183 90 199L81 208H46Z', p.light) + sparkle(42, 69, .9, p.accent) + sparkle(195, 68, .8, p.accent);
      pet = body(type, p, 'power') + head(type, p) + headband(p);
      front = dumbbell(45, 123, p) + dumbbell(197, 123, p);
      front += shape('M91 164Q121 172 151 164L150 174Q120 185 92 174Z', p.dark, p, 2.5) + rounded(111, 169, 18, 13, 4, p.accent, p) + star(120, 175, .38, '#FFFCF1');
    } else if (stage === 4) {
      behind = ground(p, 89) + line('M30 202H58M35 212H52', p.accent, 3) + shape('M143 126Q169 115 172 138L167 167 149 165Z', p.accent, p);
      behind += line('M185 158V51M185 53 212 62 185 73', p.dark, 3) + path('M187 54 210 62 187 70Z', p.accent);
      pet = `<g transform="translate(-11 5) scale(.97)">${body(type, p, 'travel')}${head(type, p)}${scarf(p)}</g>`;
      front = line('M168 145H195M183 146 173 199', p.ink, 7) + line('M168 145H195M183 146 173 199', p.accent, 4);
      front += shape('M76 195H172Q182 195 181 201Q179 207 168 207H81Q69 207 69 201Q69 196 76 195Z', p.accent, p);
      front += circle(91, 211, 10, p.ink) + circle(91, 211, 4, p.light) + circle(164, 211, 10, p.ink) + circle(164, 211, 4, p.light);
      front += sparkle(44, 81, .75, p.accent);
    } else if (stage === 5) {
      behind = cloud(51, 176, .7) + cloud(185, 68, .52) + ellipse(125, 211, 62, 7, p.dark, 'opacity=".08"');
      behind += shape('M98 144Q76 82 30 80Q30 127 61 142L45 144Q54 166 96 164Z', p.light, p) + shape('M143 142Q170 85 212 87Q207 129 180 144L196 143Q189 162 148 163Z', p.light, p);
      behind += line('M40 91Q54 117 82 134M40 111Q53 130 71 136M201 98Q185 123 162 138M202 119 179 138', p.fur, 4);
      const goggles = type === 'mechcrab'
        ? line('M80 74Q120 61 163 74', p.ink, 6) + rounded(77, 67, 27, 17, 7, '#CAE9ED', p) + rounded(138, 67, 27, 17, 7, '#CAE9ED', p) + line('M104 75H138M83 71 90 78M144 71 151 78', '#FFFFFF', 2.5)
        : line('M82 89Q120 71 161 88', p.ink, 7) + rounded(88, 77, 27, 17, 7, '#CAE9ED', p) + rounded(126, 77, 27, 17, 7, '#CAE9ED', p) + line('M115 84H126M95 82 102 88M133 82 140 88', '#FFFFFF', 2.5);
      pet = `<g class="pet-fly" transform="translate(0 -3) rotate(7 120 130)">${body(type, p, 'fly')}${head(type, p)}${scarf(p)}${goggles}</g>`;
      front = cloud(127, 208, .72) + star(49, 55, .7, p.accent) + sparkle(198, 183, .85, p.accent) + circle(207, 161, 3, p.cheek);
    } else if (stage === 6) {
      behind = ground(p, 84) + rounded(164, 173, 41, 15, 4, p.accent, p) + rounded(172, 157, 31, 15, 4, p.light, p);
      behind += line('M170 179H198M179 164H198', '#FFFCF4', 3) + sparkle(51, 104, .8, p.accent);
      pet = body(type, p, 'read') + head(type, p);
      pet += shape('M93 77V64Q120 53 147 64V78Q121 88 93 77Z', p.dark, p, 2.5);
      pet += shape('M77 62 119 44 164 62 121 79Z', p.dark, p, 2.5) + line('M120 60 161 63V85', p.accent, 3) + ellipse(161, 90, 4, 7, p.accent);
      pet += type === 'mechcrab'
        ? `<g fill="none" stroke="${p.ink}" stroke-width="3" ${outline}><circle cx="91" cy="73" r="14"/><circle cx="151" cy="73" r="14"/><path d="M105 73Q120 68 137 73M77 72 71 78M165 72 171 78"/></g>`
        : `<g fill="none" stroke="${p.ink}" stroke-width="3" ${outline}><circle cx="101" cy="109" r="14"/><circle cx="140" cy="109" r="14"/><path d="M115 107Q120 103 126 107M87 105 79 101M154 105 161 101"/></g>`;
      front = shape('M65 158Q93 148 120 163Q148 148 176 159L171 200Q145 191 120 207Q93 192 69 200Z', p.accent, p);
      front += shape('M74 155Q97 153 120 166Q143 153 167 155L164 191Q143 186 120 200Q97 187 77 192Z', '#FFFCF4', p, 2.5);
      front += line('M120 166V200M86 166 110 173M87 176 107 182M134 172 155 165M134 182 155 175', p.dark, 2.3);
      front += ellipse(70, 169, 9, 12, p.fur, `stroke="${p.ink}" stroke-width="2.5"`) + ellipse(172, 169, 9, 12, p.fur, `stroke="${p.ink}" stroke-width="2.5"`);
      front += circle(44, 150, 13, '#FFF4C4', `stroke="${p.ink}" stroke-width="2.5"`) + line('M39 166H48M43 130V123M25 146H19M29 134 24 129', p.accent, 3);
    } else {
      behind = ground(p, 83) + path('M184 25Q218 101 158 146Q213 138 220 91Q225 47 184 25Z', '#F5D784') + star(54, 58, .85, p.accent) + star(192, 52, .4, '#FFFFFF');
      behind += line('M34 121 50 95 65 111M189 177 208 157 216 179', p.fur, 1.5) + circle(34, 121, 3, p.accent) + circle(50, 95, 3, p.accent) + circle(65, 111, 3, p.accent);
      behind += shape('M94 137Q72 157 58 199Q73 192 82 205L97 199 117 212 139 200 157 207 181 194Q159 157 146 137Z', p.dark, p);
      behind += path('M95 147 81 195 99 188 119 206 140 190 158 198 144 147Z', p.light);
      pet = body(type, p, 'guard') + head(type, p);
      pet += shape('M91 140 106 150 121 141 134 151 149 140 145 157Q118 169 96 156Z', p.accent, p, 2.5) + star(120, 157, .7, '#FFFCF1', p.ink);
      pet += shape('M93 81 90 66 107 73 120 57 133 73 150 65 147 82Q121 75 93 81Z', p.accent, p, 2.5) + circle(120, 73, 4, p.light);
      front = line('M185 108 175 198', p.ink, 7) + line('M185 108 175 198', p.accent, 3.5) + star(187, 99, 1.45, p.accent, p.ink) + star(187, 99, .6, '#FFFCF1');
      front += star(74, 183, .5, p.accent) + sparkle(44, 169, .85, p.accent) + sparkle(166, 34, .7, p.cheek) + circle(203, 190, 3, p.accent);
    }
    if (type === 'elephant') {
      // Let the trunk curl over a scarf/collar and, for the baby, over the eggshell.
      // Reuse the exact character transforms rather than screen-space positions.
      const trunk = shape('M111 122Q111 134 112 143Q114 155 128 158Q145 161 151 147Q155 138 148 135Q142 133 140 140Q139 147 133 147Q125 147 127 136L130 122', p.fur, p)
        + line('M113 132 128 133M115 140 126 141', p.dark, 2.2);
      const transform = stage === 1 ? 'translate(11 34) scale(.9)' : stage === 2 ? 'rotate(-9 120 150)' : stage === 4 ? 'translate(-11 5) scale(.97)' : stage === 5 ? 'translate(0 -3) rotate(7 120 130)' : '';
      const visibleTrunk = `<g${transform ? ` transform="${transform}"` : ''}>${trunk}</g>`;
      if (stage === 1) front += visibleTrunk;
      else pet += visibleTrunk;
    }
    if (type === 'mammoth') {
      // Long-nosed anatomy stays in front of collars/books and the baby shell.
      const trunk = shape('M110 119 130 119 131 145Q136 158 145 145Q153 139 154 149Q149 168 132 164Q114 164 112 144Z', p.fur, p)
        + line('M114 136H129M117 146 130 147', p.dark, 2);
      const transform = stage === 1 ? 'translate(11 34) scale(.9)' : stage === 2 ? 'rotate(-9 120 150)' : stage === 4 ? 'translate(-11 5) scale(.97)' : stage === 5 ? 'translate(0 -3) rotate(7 120 130)' : '';
      const visibleTrunk = `<g${transform ? ` transform="${transform}"` : ''}>${trunk}</g>`;
      if (stage === 1) front += visibleTrunk;
      else pet += visibleTrunk;
    }
    return `<g class="pet-scene-back">${behind}</g><g class="pet-character">${pet}</g><g class="pet-scene-front">${front}</g>`;
  }

  function escape(value) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function render(type, level, options) {
    const safeType = typeof type === 'string' && Object.prototype.hasOwnProperty.call(palettes, type) ? type : 'owl';
    const number = typeof level === 'number' || (typeof level === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(level)) ? Number(level) : 1;
    const actualLevel = Number.isFinite(number) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number))) : 1;
    const stage = Math.min(7, actualLevel);
    const safeOptions = options && typeof options === 'object' ? options : {};
    const extraClass = typeof safeOptions.className === 'string' ? safeOptions.className.slice(0, 512) : '';
    const animated = safeOptions.animated === true;
    const label = `${names[safeType]} · LV${actualLevel} ${stages[stage - 1]}`;
    const classes = `pet-svg pet-stage-${stage}${animated ? ' pet-animated' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    // Deliberately no SVG IDs, remote URLs, image references, scripts or input-derived styles.
    // Applications may animate .pet-character/.pet-scene-front when .pet-animated is set.
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${escape(classes)}" viewBox="0 0 240 240" role="img" aria-label="${escape(label)}" data-pet="${safeType}" data-stage="${stage}" data-level="${actualLevel}" focusable="false"><title>${escape(label)}</title>${scene(safeType, stage, palettes[safeType])}</svg>`;
  }

  const api = Object.freeze({ render, names, stages });
  if (root) root.PetArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
